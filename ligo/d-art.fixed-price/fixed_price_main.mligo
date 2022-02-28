#include "fixed_price_interface.mligo"
#include "../common.mligo"
#include "fixed_price_check.mligo"
#include "admin_main.mligo"

type fixed_price_entrypoints =
    | Admin of admin_entrypoints
    | CreateSale of sale_info
    | UpdateSale of sale_info
    | RevokeSale of sale_deletion
    | CreateDrop of drop_configuration
    | RevokeDrop of drop_info
    | RegisterToDrop of drop_info
    | ClaimUtilityToken of drop_info
    | BuyFixedPriceToken of buy_token
    | BuyDroppedToken of buy_token

// Fixed price sales functions

let create_sale (sale_info, storage : sale_info * storage) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be should ne greater 0mutez") in
    let () = verify_signature (sale_info.authorization_signature, storage) in
    let () = assert_msg (Tezos.sender = sale_info.seller, "Only owner can create a sale") in
    let () = assert_msg (sale_info.price > 0mutez, "Price should be greater than 0" ) in
    let () = assert_msg (sale_info.fa2_token.amount > 0n, "Amount should be greater than 0" ) in
    let () = assert_msg (not storage.admin.contract_will_update, "This contract is or will be deprecated, you can not create sale on it") in
    let () = assert_wrong_allowlist (sale_info.fa2_token, sale_info.allowlist) in

    let fixed_price_sale_values : fixed_price_sale = {
        price = sale_info.price;
        token_amount = sale_info.fa2_token.amount;
        allowlist = sale_info.allowlist;
    } in

    let fa2_base : fa2_base = {
        address= sale_info.fa2_token.address;
        id=sale_info.fa2_token.id;
    } in

    let () = assert_msg (not Big_map.mem (fa2_base, Tezos.sender) storage.for_sale, "Token already for sale, only update or revoke are authorized") in

    let fa2_transfer : operation = transfer_token ({ from_ = Tezos.sender; txs = [{ to_ = Tezos.self_address; token_id = sale_info.fa2_token.id; amount = sale_info.fa2_token.amount }] }, sale_info.fa2_token.address) in
    let new_strg = {
        storage with
        for_sale = Big_map.add ({ address = sale_info.fa2_token.address; id = sale_info.fa2_token.id; }, sale_info.seller) fixed_price_sale_values storage.for_sale;
        admin.signed_message_used = Big_map.add sale_info.authorization_signature unit storage.admin.signed_message_used
    } in

    ([fa2_transfer], new_strg)

let update_sale (sale_info, storage : sale_info * storage ) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in
    let () = assert_msg (Tezos.sender = sale_info.seller, "Only seller can update the sale") in
    let () = assert_msg (sale_info.price > 0mutez, "Price should be greater than 0" ) in
    let () = assert_msg (sale_info.fa2_token.amount > 0n, "Amount should be greater than 0" ) in

    let fa2_base : fa2_base = {
        address = sale_info.fa2_token.address;
        id = sale_info.fa2_token.id;
    } in

    let () = assert_msg (Big_map.mem (fa2_base, Tezos.sender) storage.for_sale, "Token is not for sale") in

    let fixed_price_sale_values : fixed_price_sale = {
        price = sale_info.price;
        token_amount = sale_info.fa2_token.amount;
        allowlist = sale_info.allowlist;
    } in

    let new_strg = { storage with for_sale = Big_map.update (fa2_base, sale_info.seller) (Some fixed_price_sale_values) storage.for_sale } in

    ([] : operation list), new_strg

let revoke_sale (sale_info, storage : sale_deletion * storage) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in
    let () = assert_msg (Tezos.sender = sale_info.seller, "Only seller can remove the token from sale") in

    let sale : fixed_price_sale = get_sale (sale_info.fa2_base, sale_info.seller, storage) in

    let fa2_token : fa2_token = {
        address = sale_info.fa2_base.address;
        id = sale_info.fa2_base.id;
        amount = sale.token_amount;
    } in

    let fa2_transfer : operation = transfer_token ({ from_ = Tezos.self_address; txs = [{ to_ = Tezos.sender; token_id = fa2_token.id; amount = fa2_token.amount }] }, fa2_token.address) in
    let new_strg = { storage with for_sale = Big_map.remove (sale_info.fa2_base, sale_info.seller) storage.for_sale } in

    ([fa2_transfer], new_strg)

let buy_fixed_price_token (buy_token, storage : buy_token * storage) : return =

    let () = assert_msg (Tezos.sender <> buy_token.seller, "Seller can not buy the token") in
    let () = verify_signature (buy_token.authorization_signature, storage) in

    let fa2_base : fa2_base = {
        address = buy_token.fa2_token.address;
        id = buy_token.fa2_token.id;
    } in

    let concerned_fixed_price_sale : fixed_price_sale = get_sale (fa2_base, buy_token.seller, storage) in

    let () = assert_msg (concerned_fixed_price_sale.token_amount >= buy_token.fa2_token.amount, "Token amount to high" ) in
    let () = fail_if_token_amount_to_high (concerned_fixed_price_sale.allowlist, buy_token) in
    let () = assert_msg (concerned_fixed_price_sale.price * buy_token.fa2_token.amount = Tezos.amount, "Wrong price specified") in

    let operation_list : operation list = perform_sale_operation (buy_token, concerned_fixed_price_sale.price, storage) in

    let new_fixed_price_sale = {
        concerned_fixed_price_sale with
        token_amount =  abs (concerned_fixed_price_sale.token_amount - buy_token.fa2_token.amount);
        allowlist = reduce_buyer_credit concerned_fixed_price_sale.allowlist
    } in

    if new_fixed_price_sale.token_amount = 0n
    then operation_list, { storage with for_sale = Big_map.remove (fa2_base, buy_token.seller) storage.for_sale; admin.signed_message_used = Big_map.add buy_token.authorization_signature unit storage.admin.signed_message_used }
    else operation_list, { storage with for_sale = Big_map.update (fa2_base, buy_token.seller) (Some new_fixed_price_sale) storage.for_sale; admin.signed_message_used = Big_map.add buy_token.authorization_signature unit storage.admin.signed_message_used }

// Drop functions

let create_drop (drop_info, storage : drop_configuration * storage) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in
    let () = verify_signature (drop_info.authorization_signature, storage) in
    let () = assert_msg (Tezos.sender = drop_info.seller, "Only seller can create a drop") in
    let () = assert_msg (drop_info.price > 0mutez, "Price should be greater than 0" ) in
    let () = assert_msg (drop_info.fa2_token.amount > 0n, "Amount should be greater than 0" ) in
    let () = assert_msg (not storage.admin.contract_will_update, "This contract is deprecated, you can not create sale on it") in
    let () = assert_msg(Big_map.mem Tezos.sender storage.authorized_drops_seller, "Not authorized drop seller") in
    let () = fail_if_wrong_drop_date (drop_info.drop_date) in
    let () = assert_wrong_registration_conf (drop_info) in

    // Registration
    let fa2_base : fa2_base = {
        address = drop_info.fa2_token.address;
        id = drop_info.fa2_token.id;
    } in

    let () = assert_msg (not Big_map.mem (fa2_base, Tezos.sender) storage.drops, "Token has already been dropped") in
    let () = assert_msg (not Big_map.mem fa2_base storage.fa2_dropped, "Token has already been dropped") in

    let empty_address_list : (address, unit) map = Map.empty in

    let fixed_price_drop : fixed_price_drop = {
        price = drop_info.price;
        token_amount = drop_info.fa2_token.amount;
        registration = drop_info.registration;
        registered_buyers = empty_address_list;
        drop_owners = empty_address_list;
        drop_date = drop_info.drop_date;
    } in

    let transfer : operation = transfer_token ({ from_ = Tezos.sender; txs = [{ to_ = Tezos.self_address; token_id = drop_info.fa2_token.id; amount = drop_info.fa2_token.amount}] }, drop_info.fa2_token.address) in

    let new_strg : storage = {
        storage with
        fa2_dropped = Big_map.add fa2_base unit storage.fa2_dropped;
        drops = Big_map.add (fa2_base, drop_info.seller) fixed_price_drop storage.drops;
        admin.signed_message_used = Big_map.add drop_info.authorization_signature unit storage.admin.signed_message_used
    } in

    [transfer], new_strg

let register_to_drop ( drop_info, storage : drop_info * storage ) : return =
    let () = verify_signature (drop_info.authorization_signature, storage) in
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in

    let fixed_price_drop : fixed_price_drop = get_drop (drop_info.fa2_base, drop_info.seller, storage) in

    let () = assert_msg (fixed_price_drop.registration.active, "Registration is not allowed") in
    let () = assert_msg (Tezos.sender <> drop_info.seller, "Seller can not register for the drop") in
    let () = assert_msg (not drop_using_utility_token fixed_price_drop, "Utility token drop, no registration possible") in
    let () = fail_if_registration_period_over (drop_info, storage) in
    let () = assert_msg (Map.mem Tezos.sender fixed_price_drop.registered_buyers, "Already registered") in

    let new_fixed_price_drop : fixed_price_drop = { fixed_price_drop with registered_buyers = Map.add Tezos.sender unit fixed_price_drop.registered_buyers } in

    let new_strg : storage = {
        storage with
        drops = Big_map.update (drop_info.fa2_base, drop_info.seller) (Some new_fixed_price_drop) storage.drops;
        admin.signed_message_used = Big_map.add drop_info.authorization_signature unit storage.admin.signed_message_used
    } in

    ([] : operation list), new_strg

let revoke_drop (drop_info, storage : drop_info * storage) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in
    let () = assert_msg (Tezos.sender = drop_info.seller, "Only seller can revoke the tokens from a drop") in

    let drop : fixed_price_drop = get_drop (drop_info.fa2_base, drop_info.seller, storage) in

    let () = assert_msg ( Tezos.now > drop.drop_date + drop.registration.priority_duration, "You can only revoke a drop after priority duration") in
    let new_drop_strg : drops_storage = Big_map.remove (drop_info.fa2_base, drop_info.seller) storage.drops in

    // Transfer all utility tokens back to owner, in case no utility token then send blank operation list
    let utility_token_operation_list : operation list =
        match drop.registration.utility_token with
            None -> (failwith "No utility token found for this drop" : operation list)
            | Some utility_token -> if Map.size drop.drop_owners > 0n then transfer_utility_token_back_to_buyers (utility_token, drop) else ([] : operation list)
        in

    utility_token_operation_list, { storage with drops = new_drop_strg }

let claim_utility_token (drop_info, storage : drop_info * storage) : return =
    let () = assert_msg (Tezos.amount = 0mutez, "Amount sent must be 0mutez") in

    let drop : fixed_price_drop = get_drop (drop_info.fa2_base, drop_info.seller, storage) in

    let () = assert_msg ( drop.registration.active, "Not a registration drop") in
    let () = assert_msg ( Tezos.now > drop.drop_date + drop.registration.priority_duration, "You can only claim a utility token after priority duration") in
    let () = assert_msg ( Map.mem Tezos.sender drop.drop_owners, "Unauthorized to claim token" ) in

    let new_drop : fixed_price_drop = { drop with drop_owners = Map.remove Tezos.sender drop.drop_owners } in
    let new_drops_strg : drops_storage = Map.update (drop_info.fa2_base, drop_info.seller) (Some new_drop) storage.drops in

    // Transfer utility token back to owner
    let utility_token_operation_list : operation list =
        match new_drop.registration.utility_token with
            None -> (failwith "No utility token found for this drop" : operation list)
            | Some utility_token -> [transfer_token ({ from_ = Tezos.self_address; txs = [{ to_ = Tezos.sender; token_id = utility_token.id; amount = 1n}] }, utility_token.address)]
    in

    utility_token_operation_list, { storage with drops = new_drops_strg }

let buy_dropped_token (buy_token, storage : buy_token * storage) : return =
    let () = assert_msg (Tezos.sender <> buy_token.seller, "Seller can not buy the token") in
    let () = verify_signature (buy_token.authorization_signature, storage) in

    let fa2_base : fa2_base = {
        address = buy_token.fa2_token.address;
        id = buy_token.fa2_token.id;
    } in

    let concerned_fixed_price_drop : fixed_price_drop = get_drop (fa2_base, buy_token.seller, storage) in

    let () = assert_msg (concerned_fixed_price_drop.token_amount >= buy_token.fa2_token.amount, "Token amount to high" ) in
    let () = fail_if_drop_date_not_met concerned_fixed_price_drop in
    let () = fail_if_sender_not_authorized_for_fixed_price_drop (concerned_fixed_price_drop, buy_token) in
    let () = assert_msg (concerned_fixed_price_drop.price = Tezos.amount, "Wrong price specified") in

    // reigstered buyers can only own one token
    let new_fixed_price_drop = {
        concerned_fixed_price_drop with
        token_amount =  abs (concerned_fixed_price_drop.token_amount - buy_token.fa2_token.amount);
        registered_buyers = Map.remove Tezos.sender concerned_fixed_price_drop.registered_buyers;
        drop_owners = Map.add Tezos.sender unit concerned_fixed_price_drop.drop_owners;
    } in

    let new_drops : drops_storage = if new_fixed_price_drop.token_amount = 0n
    then Big_map.remove (fa2_base, buy_token.seller) storage.drops
    else Big_map.update (fa2_base, buy_token.seller) (Some(new_fixed_price_drop)) storage.drops in

    let utility_token_operation_list : operation list = if new_fixed_price_drop.registration.active && new_fixed_price_drop.registration.priority_duration + new_fixed_price_drop.drop_date < Tezos.now
    then match new_fixed_price_drop.registration.utility_token with
        None -> ([] : operation list)
        | Some utility_token ->
            if new_fixed_price_drop.token_amount = 0n
            then transfer_utility_token_back_to_buyers (utility_token, new_fixed_price_drop)
            else [transfer_token ({ from_ = Tezos.sender; txs = [{ to_ = Tezos.self_address; token_id = utility_token.id; amount = 1n}] }, utility_token.address)]
    else ([] : operation list) in

    let operation_list : operation list = perform_sale_operation (buy_token, new_fixed_price_drop.price, storage) in

    let conct_list ( second_list, el: (operation list) * operation) : (operation list) = (el :: second_list) in
    let ops : (operation list) = List.fold_left conct_list operation_list utility_token_operation_list in

    let new_strg = { storage with drops = new_drops; admin.signed_message_used = Big_map.add buy_token.authorization_signature unit storage.admin.signed_message_used } in

    ops, new_strg


let fixed_price_tez_main (p , storage : fixed_price_entrypoints * storage) : return = match p with
    | Admin admin_param -> admin_main (admin_param, storage)

    // Fixed price sales entrypoints
    | CreateSale sale_info -> create_sale(sale_info, storage)
    | UpdateSale updated_sale -> update_sale(updated_sale, storage)
    | RevokeSale token_info -> revoke_sale(token_info, storage)

    // Drops entrypoints
    | CreateDrop drop_configuration -> create_drop(drop_configuration, storage)
    | RegisterToDrop registration_param -> register_to_drop(registration_param, storage)
    | RevokeDrop drop_info -> revoke_drop(drop_info, storage)
    | ClaimUtilityToken drop_info -> claim_utility_token (drop_info, storage)

    // Buy token in any sales or drops
    | BuyFixedPriceToken buy_token -> buy_fixed_price_token(buy_token, storage)
    | BuyDroppedToken buy_token -> buy_dropped_token(buy_token, storage)
