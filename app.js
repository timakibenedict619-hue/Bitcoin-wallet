import { Buffer } from "https://esm.sh/buffer@6.0.3";
globalThis.Buffer = Buffer;

import * as bitcoin from "https://esm.sh/bitcoinjs-lib@6.1.7?bundle";
import * as ecc from "https://esm.sh/tiny-secp256k1@2.2.3?bundle";
import { BIP32Factory } from "https://esm.sh/bip32@4.0.0?bundle";
import {
    mnemonicToSeedSync,
    generateMnemonic
} from "https://esm.sh/bip39@3.1.0?bundle";

import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";

bitcoin.initEccLib(ecc);

const bip32 = BIP32Factory(ecc);

const network = bitcoin.networks.testnet;

const STORAGE_KEY = "demo_testnet_wallet_v1";

const SATOSHIS = 100000000;

const API = "https://blockstream.info/testnet/api";


// ================================
// CREATE / LOAD WALLET
// ================================

function loadWallet() {

    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {

        return JSON.parse(saved);

    }

    console.log("Creating new Testnet wallet...");

    const mnemonic = generateMnemonic(128);

    const seed = mnemonicToSeedSync(mnemonic);

    const root = bip32.fromSeed(seed, network);

    const node = root.derivePath(
        "m/84'/1'/0'/0/0"
    );

    const payment = bitcoin.payments.p2wpkh({

        pubkey: Buffer.from(node.publicKey),

        network

    });

    if (!payment.address) {

        throw new Error(
            "Could not generate wallet address."
        );

    }

    const wallet = {

        mnemonic: mnemonic,

        address: payment.address,

        privateKeyHex:
            Buffer.from(node.privateKey).toString("hex")

    };

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(wallet)
    );

    console.log(
        "New Testnet wallet created:",
        wallet.address
    );

    return wallet;
}


// ================================
// INITIALIZE WALLET
// ================================

let wallet;

try {

    wallet = loadWallet();

    document.getElementById("address").textContent =
        wallet.address;

} catch (error) {

    console.error(
        "Wallet generation failed:",
        error
    );

    document.getElementById("address").textContent =
        "Wallet generation failed";

}


// ================================
// QR CODE
// ================================

if (wallet && wallet.address) {

    QRCode.toCanvas(
        wallet.address,
        {
            width: 200
        },
        function(error, canvas) {

            if (error) {

                console.error(
                    "QR generation failed:",
                    error
                );

                return;

            }

            document
                .getElementById("qr")
                .replaceChildren(canvas);

        }
    );

}


// ================================
// COPY ADDRESS
// ================================

document
    .getElementById("copy")
    .addEventListener("click", async () => {

        if (!wallet || !wallet.address) {

            alert("Wallet is not ready.");

            return;

        }

        try {

            await navigator.clipboard.writeText(
                wallet.address
            );

            alert(
                "Testnet address copied."
            );

        } catch (error) {

            console.error(error);

            alert(
                "Could not copy address."
            );

        }

    });


// ================================
// GET BALANCE + UTXOs
// ================================

async function getBalanceAndUtxos() {

    if (!wallet) {

        throw new Error(
            "Wallet has not been generated."
        );

    }

    const [
        addressResponse,
        utxoResponse
    ] = await Promise.all([

        fetch(
            `${API}/address/${wallet.address}`
        ),

        fetch(
            `${API}/address/${wallet.address}/utxo`
        )

    ]);

    if (
        !addressResponse.ok ||
        !utxoResponse.ok
    ) {

        throw new Error(
            "Could not connect to Bitcoin Testnet."
        );

    }

    const addressData =
        await addressResponse.json();

    const utxos =
        await utxoResponse.json();

    const funded =
        (addressData.chain_stats?.funded_txo_sum || 0) +
        (addressData.mempool_stats?.funded_txo_sum || 0);

    const spent =
        (addressData.chain_stats?.spent_txo_sum || 0) +
        (addressData.mempool_stats?.spent_txo_sum || 0);

    return {

        balance: funded - spent,

        utxos: utxos

    };

}


// ================================
// REFRESH BALANCE
// ================================

async function refresh() {

    const balanceElement =
        document.getElementById("balance");

    balanceElement.textContent =
        "Checking...";

    try {

        const result =
            await getBalanceAndUtxos();

        const btc =
            result.balance / SATOSHIS;

        balanceElement.textContent =
            btc.toFixed(8) + " BTC";

    } catch (error) {

        console.error(
            "Balance error:",
            error
        );

        balanceElement.textContent =
            "Unable to load";

    }

}


// ================================
// VALIDATE TESTNET ADDRESS
// ================================

function isValidTestnetAddress(address) {

    try {

        bitcoin.address.toOutputScript(
            address.trim(),
            network
        );

        return true;

    } catch {

        return false;

    }

}


// ================================
// SEND TESTNET BTC
// ================================

async function sendTestnetBTC() {

    const recipient =
        document.getElementById("recipient")
            .value
            .trim();

    const amountText =
        document.getElementById("amount")
            .value
            .trim();

    const result =
        document.getElementById("sendResult");

    const button =
        document.getElementById("send");


    result.textContent = "";


    if (!recipient) {

        result.textContent =
            "Enter a Testnet Bitcoin address.";

        return;

    }


    if (!isValidTestnetAddress(recipient)) {

        result.textContent =
            "Invalid Testnet Bitcoin address.";

        return;

    }


    const amountBTC =
        Number(amountText);


    if (
        !Number.isFinite(amountBTC) ||
        amountBTC <= 0
    ) {

        result.textContent =
            "Enter a valid BTC amount.";

        return;

    }


    const amount =
        Math.round(
            amountBTC * SATOSHIS
        );


    // Simple Testnet development fee
    const fee = 1000;


    button.disabled = true;

    result.textContent =
        "Preparing transaction...";


    try {

        const {
            utxos
        } = await getBalanceAndUtxos();


        const sorted =
            [...utxos].sort(
                (a, b) =>
                    b.value - a.value
            );


        let selected = [];

        let total = 0;


        for (const utxo of sorted) {

            selected.push(utxo);

            total += utxo.value;

            if (
                total >=
                amount + fee
            ) {

                break;

            }

        }


        if (
            total <
            amount + fee
        ) {

            throw new Error(
                "Insufficient Testnet BTC."
            );

        }


        const change =
            total - amount - fee;


        const psbt =
            new bitcoin.Psbt({
                network: network
            });


        const payment =
            bitcoin.payments.p2wpkh({

                address: wallet.address,

                network: network

            });


        for (
            const utxo of selected
        ) {

            const txResponse =
                await fetch(
                    `${API}/tx/${utxo.txid}/hex`
                );


            if (!txResponse.ok) {

                throw new Error(
                    "Could not retrieve transaction."
                );

            }


            const txHex =
                await txResponse.text();


            psbt.addInput({

                hash: utxo.txid,

                index: utxo.vout,

                witnessUtxo: {

                    script: payment.output,

                    value: utxo.value

                },

                nonWitnessUtxo:
                    Buffer.from(
                        txHex,
                        "hex"
                    )

            });

        }


        // Recipient output

        psbt.addOutput({

            address: recipient,

            value: amount

        });


        // Change output

        if (change > 0) {

            psbt.addOutput({

                address:
                    wallet.address,

                value: change

            });

        }


        const node =
            bip32.fromPrivateKey(

                Buffer.from(
                    wallet.privateKeyHex,
                    "hex"
                ),

                Buffer.alloc(32),

                network

            );


        for (
            let i = 0;
            i < selected.length;
            i++
        ) {

            psbt.signInput(
                i,
                node
            );

        }


        psbt.finalizeAllInputs();


        const transaction =
            psbt.extractTransaction();


        const txHex =
            transaction.toHex();


        result.textContent =
            "Broadcasting transaction...";


        const broadcast =
            await fetch(
                `${API}/tx`,
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "text/plain"
                    },

                    body: txHex

                }
            );


        const response =
            await broadcast.text();


        if (!broadcast.ok) {

            throw new Error(
                response ||
                "Testnet rejected the transaction."
            );

        }


        result.innerHTML = `
            Transaction sent successfully.<br>
            <strong>TXID:</strong><br>
            ${response}
        `;


        document
            .getElementById("recipient")
            .value = "";

        document
            .getElementById("amount")
            .value = "";


        await refresh();


    } catch (error) {

        console.error(
            "Send error:",
            error
        );

        result.textContent =
            "Send failed: " +
            error.message;

    } finally {

        button.disabled = false;

    }

}


// ================================
// BUTTONS
// ================================

document
    .getElementById("refresh")
    .addEventListener(
        "click",
        refresh
    );


document
    .getElementById("send")
    .addEventListener(
        "click",
        sendTestnetBTC
    );


// ================================
// START
// ================================

refresh();


console.log(
    "TESTNET WALLET ADDRESS:",
    wallet?.address
);

console.log(
    "TESTNET WALLET MNEMONIC — NEVER SHARE:",
    wallet?.mnemonic
);
