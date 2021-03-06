require('dotenv').config()
import * as fs from 'fs';
import * as path from 'path';
import * as kleur from 'kleur';
import * as child from 'child_process';

import { loadFile } from './helper';
import { NFTStorage } from 'nft.storage';
import { char2Bytes } from '@taquito/tzip16';
import { Parser} from '@taquito/michel-codec';
import { InMemorySigner } from '@taquito/signer';
import { MichelsonMap, TezosToolkit } from '@taquito/taquito';

// -- View import
import { default as Splits } from './views/fa2_editions_splits.tz';
import { default as Minter } from './views/fa2_editions_minter.tz';
import { default as Royalty } from './views/fa2_editions_royalty.tz';
import { default as IsMinter } from './views/fa2_editions_is_minter.tz';
import { default as RoyaltySplits } from './views/fa2_editions_royalty_splits.tz';
import { default as EditionsMetadata } from './views/fa2_editions_token_metadata.tz';
import { default as RoyaltyDistribution } from './views/fa2_editions_royalty_distribution.tz';

const client = new NFTStorage({
	token: process.env.NFT_STORAGE_KEY!,
})

enum ContractAction {
    COMPILE = "compile contract",
    SIZE = "info measure-contract"
}

async function contractAction (contractName: string, action: ContractAction, pathString: string, mainFunction: string, compilePath?: string) : Promise<void> {
    await new Promise<void>((resolve, reject) =>
        child.exec(
            path.join(__dirname, `../ligo/exec_ligo ${action} ` + path.join(__dirname, `../ligo/${pathString}`) + ` -e ${mainFunction}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to compile the contract.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    // Write json contract into json file
                    if (action === ContractAction.COMPILE) {
                        console.log(kleur.green(`Compiled ${contractName} contract succesfully at: `))
                        console.log('  ' + path.join(__dirname, `../ligo/${compilePath}`))
                        fs.writeFileSync(path.join(__dirname, `../ligo/${compilePath}`), stdout)
                    }

                    if (action === ContractAction.SIZE) {
                        console.log(kleur.green(`Contract ${contractName} size: ${stdout}`))
                    }
                    resolve();
                }
            }
        )
    );
}

// -- Compile contracts --

export async function compileContracts(param: any): Promise<void> {
    switch (param.title) {
        case "fixed-price":
            contractAction("Fixed-price", ContractAction.COMPILE, "d-art.fixed-price/fixed_price_main.mligo", "fixed_price_tez_main", "d-art.fixed-price/compile/fixed_price_main.tz")
            break;
        case "fa2-editions":
            contractAction("Fa2 editions", ContractAction.COMPILE, "d-art.fa2-editions/views.mligo", "editions_main --views 'token_metadata, royalty_distribution, splits, royalty_splits, royalty, minter, is_minter'", "d-art.fa2-editions/compile/multi_nft_token_editions.tz")
            break;
        default:
            contractAction("Fixed-price", ContractAction.COMPILE, "d-art.fixed-price/fixed_price_main.mligo", "fixed_price_tez_main", "d-art.fixed-price/compile/fixed_price_main.tz")
            contractAction("Fa2 editions", ContractAction.COMPILE, "d-art.fa2-editions/views.mligo", "editions_main --views 'token_metadata, royalty_distribution, splits, royalty_splits, royalty, minter, is_minter'", "d-art.fa2-editions/compile/multi_nft_token_editions.tz")
            break;
    }
}

export async function calculateSize(param: any): Promise<void> {
    switch (param.title) {
        case "fixed-price":
            contractAction("Fixed-price", ContractAction.SIZE, "d-art.fixed-price/fixed_price_main.mligo", "fixed_price_tez_main")
            break;
        case "fa2-editions":
            contractAction("Fa2 editions", ContractAction.SIZE, "d-art.fa2-editions/views.mligo", "editions_main --views 'token_metadata, royalty_distribution, splits, royalty_splits, royalty, minter, is_minter'")
            break;
        default:
            contractAction("Fixed-price", ContractAction.SIZE, "d-art.fixed-price/fixed_price_main.mligo", "fixed_price_tez_main")
            contractAction("Fa2 editions", ContractAction.SIZE, "d-art.fa2-editions/views.mligo", "editions_main --views 'token_metadata, royalty_distribution, splits, royalty_splits, royalty, minter, is_minter'")
            break;
    }
}

// -- Deploy contracts --

export async function deployFixedPriceContract(): Promise<void> {
    const code = await loadFile(path.join(__dirname, '../ligo/d-art.fixed-price/compile/fixed_price_main.tz'))

    const originateParam = {
        code: code,
        storage: {
            admin: {
                address: process.env.ADMIN_PUBLIC_KEY_HASH,
                pb_key: process.env.SIGNER_PUBLIC_KEY,
                signed_message_used: new MichelsonMap(),
                contract_will_update: false
            },
            for_sale: MichelsonMap.fromLiteral({}),
            drops: MichelsonMap.fromLiteral({}),
            fa2_dropped: MichelsonMap.fromLiteral({}),
            fee: {
                address: process.env.ADMIN_PUBLIC_KEY_HASH,
                percent: 10,
            }
        }
    }

    try {
        const toolkit = await new TezosToolkit('https://ithacanet.ecadinfra.com');

        toolkit.setProvider({ signer: await InMemorySigner.fromSecretKey(process.env.ORIGINATOR_PRIVATE_KEY!) });

        const originationOp = await toolkit.contract.originate(originateParam);

        await originationOp.confirmation();
        const { address } = await originationOp.contract()

        console.log('Contract deployed at: ', address)

    } catch (error) {
        const jsonError = JSON.stringify(error);
        console.log(kleur.red(`Fixed price sale (tez) origination error ${jsonError}`));
    }
}

export async function deployEditionContract(): Promise<void> {
    const code = await loadFile(path.join(__dirname, '../ligo/d-art.fa2-editions/compile/multi_nft_token_editions.tz'))

    const p = new Parser();

    const parsedSplitsMichelsonCode = p.parseMichelineExpression(Splits.code);
    const parsedMinterMichelsonCode = p.parseMichelineExpression(Minter.code);
    const parsedRoyaltyMichelsonCode = p.parseMichelineExpression(Royalty.code);
    const parsedIsMinterMichelsonCode = p.parseMichelineExpression(IsMinter.code);
    const parsedRoyaltySplitsMichelsonCode = p.parseMichelineExpression(RoyaltySplits.code);
    const parsedEditionMetadataMichelsonCode = p.parseMichelineExpression(EditionsMetadata.code);
    const parsedRoyaltyDistributionMichelsonCode = p.parseMichelineExpression(RoyaltyDistribution.code);

    // TODO : Add missing views
    const editions_contract_metadata = {
        name: 'A:RT - Original',
        description: 'Original collection for D a:rt NFTs. Edition version of the FA2 contract',
        authors: 'tz1KhMoukVbwDXRZ7EUuDm7K9K5EmJSGewxd',
        homepage: 'https://github.com/D-a-rt/d-art.contracts',
        license: "MIT",
        interfaces: ['TZIP-012', 'TZIP-016'],
        imageUri: "ipfs://bafkreidnvjk6h7w7a6lp27t2tkmrzoqyjizedqnr5ojf525sm5jkfel2yy",
        views: [{
            name: 'token_metadata',
            description: 'Get the metadata for the tokens minted using this contract',
            pure: false,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // (pair (nat %token_id) (map %token_info string bytes))
                        returnType: {
                            prim: "pair",
                            args: [
                                { prim: "nat", annots: ["%token_id"] },
                                { prim: "map", args: [{ prim: "string" }, { prim: "bytes" }], annots: ["%token_info"] },
                            ],
                        },
                        code: parsedEditionMetadataMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'royalty_distribution',
            description: 'Get the minter of a specify token as well as the amount of royalty and the splits corresponding to it.',
            pure: true,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // (pair address (pair (nat %royalty) (list %splits (pair (address %address) (nat %pct)))))
                        returnType: {
                            prim: "pair",
                            args: [
                                { prim: "address" },
                                { 
                                    prim: "pair", 
                                    args: [
                                        { prim: "nat", annots: ["%royalty"] },
                                        { 
                                            prim: "list", 
                                            args : [
                                                { 
                                                    prim: "pair",
                                                    args: [
                                                        { prim: "address", annots: "address" },
                                                        { prim: "nat", annots: "pct" },
                                                    ]
                                                }
                                            ], 
                                            annots: ["%splits"] 
                                        },
                                    ]
                                },
                            ],
                        },
                        code: parsedRoyaltyDistributionMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'splits',
            description: 'Get the splits for a token id.',
            pure: true,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // (list (pair (address %address) (nat %pct)))
                        returnType: { 
                            prim: "list", 
                            args : [
                                { 
                                    prim: "pair",
                                    args: [
                                        { prim: "address", annots: "address" },
                                        { prim: "nat", annots: "pct" },
                                    ]
                                }
                            ], 
                            annots: ["%splits"] 
                        },
                        code: parsedSplitsMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'royalty_splits',
            description: 'Get the royalty and splits for a token id.',
            pure: true,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // (pair (nat %royalty) (list %splits (pair (address %address) (nat %pct))))
                        returnType: { 
                            prim: "pair", 
                            args: [
                                { prim: "nat", annots: ["%royalty"] },
                                { 
                                    prim: "list", 
                                    args : [
                                        { 
                                            prim: "pair",
                                            args: [
                                                { prim: "address", annots: "address" },
                                                { prim: "nat", annots: "pct" },
                                            ]
                                        }
                                    ], 
                                    annots: ["%splits"] 
                                },
                            ]
                        },
                        code: parsedRoyaltySplitsMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'royalty',
            description: 'Get the royalty for a token id.',
            pure: true,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // nat
                        returnType: {
                            prim: 'nat',
                        },
                        code: parsedRoyaltyMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'minter',
            description: 'Get the minter for a token id.',
            pure: true,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'nat',
                        },
                        // nat
                        returnType: {
                            prim: 'address',
                        },
                        code: parsedMinterMichelsonCode,
                    },
                },
            ],
        }, {
            name: 'is_minter',
            description: 'Verify if address is minter on the contract.',
            pure: false,
            implementations: [
                {
                    michelsonStorageView:
                    {
                        parameter: {
                            prim: 'address',
                        },
                        // nat
                        returnType: {
                            prim: 'bool',
                        },
                        code: parsedIsMinterMichelsonCode,
                    },
                },
            ],
        }],
    };

    const contractMetadata = await client.storeBlob(
		new Blob([JSON.stringify(editions_contract_metadata)]),
	)

    if (!contractMetadata) {
        console.log(kleur.red(`An error happened while uploading the ipfs metadata of the contract.`));
        return;
    }

    const originateParam = {
        code: code,
        storage: {
            next_edition_id: 0,
            editions_metadata: MichelsonMap.fromLiteral({}),
            max_editions_per_run: 250,
            assets: {
                ledger: MichelsonMap.fromLiteral({}),
                operators: MichelsonMap.fromLiteral({}),
                token_metadata: MichelsonMap.fromLiteral({})
            },
            admin: {
                admin: process.env.ADMIN_PUBLIC_KEY_HASH,
                pause_minting: false,
                pause_nb_edition_minting: false,
                minters: MichelsonMap.fromLiteral({})
            },
            metadata: MichelsonMap.fromLiteral({
                "": char2Bytes(`ipfs://${contractMetadata}`),
            }),
            hash_used: MichelsonMap.fromLiteral({})
        }
    }

    try {
        const toolkit = await new TezosToolkit('https://ithacanet.ecadinfra.com');

        toolkit.setProvider({ signer: await InMemorySigner.fromSecretKey(process.env.ORIGINATOR_PRIVATE_KEY!) });


        const originationOp = await toolkit.contract.originate(originateParam);

        await originationOp.confirmation();
        const { address } = await originationOp.contract()

        console.log('Contract deployed at: ', address)

    } catch (error) {
        const jsonError = JSON.stringify(error);
        console.log(kleur.red(`Fixed price sale (tez) origination error ${jsonError}`));
    }
}

export const deployContracts = async (param: any) => {
    switch (param.title) {
        case "fixed-price":
            await deployFixedPriceContract()
            break;
        case "fa2-editions":        
            await deployEditionContract()
            break;
        default:
            await deployEditionContract()
            await deployFixedPriceContract()
            break;
    }
}

// -- Tests --

async function testFixedPriceContract(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing admin entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fixed-price/admin_main.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fixed_price_sale entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fixed-price/fixed_price_main_sale.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fixed_price_drop entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fixed-price/fixed_price_main_drop.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing buy_fixed_price entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fixed-price/fixed_price_main_buy_sale.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing buy_dropped entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fixed-price/fixed_price_main_buy_drop.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })
}

async function testEditionContract(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fa2 admin entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fa2-editions/admin.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fa2 operator entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fa2-editions/operator_lib.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fa2 standard entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fa2-editions/standard.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fa2 main (mint and burn) entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fa2-editions/multi_nft_token_editions.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })

    await new Promise<void>((resolve, reject) => {
        console.log(kleur.green(`Testing fa2 views entrypoints...`))

        child.exec(
            path.join(__dirname, `../ligo/exec_ligo run test ${path.join(__dirname, "../ligo/test/d-art.fa2-editions/views.test.mligo")}`),
            (err, stdout) => {
                if (err) {
                    console.log(kleur.red('Failed to run tests.'));
                    console.log(kleur.yellow().dim(err.toString()))
                    reject();
                } else {
                    console.log(`Results: ${stdout}`)
                    resolve()
                }
            }
        )
    })
}

export const testContracts = async (param: any) => {
    switch (param.title) {
        case "fixed-price":
            await testFixedPriceContract()
            break;
        case "fa2-editions":        
            await testEditionContract()
            break;
        default:
            await testEditionContract()
            await testFixedPriceContract()
            break;
    }
}