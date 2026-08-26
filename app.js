import * as bitcoin from "https://esm.sh/bitcoinjs-lib@6.1.7?bundle";
import * as ecc from "https://esm.sh/tiny-secp256k1@2.2.3?bundle";
import { BIP32Factory } from "https://esm.sh/bip32@4.0.0?bundle";
import {
    mnemonicToSeedSync,
    generateMnemonic
} from "https://esm.sh/bip39@3.1.0?bundle";
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";
import { Buffer } from "https://esm.sh/buffer@6.0.3?bundle";

// Make Buffer available in the browser
globalThis.Buffer = Buffer;

bitcoin.initEccLib(ecc);

const bip32 = BIP32Factory(ecc);

const network = bitcoin.networks.testnet;

const STORAGE_KEY = "demo_testnet_wallet_v1";

// Generate/load wallet
function loadWallet() {

    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
        return JSON.parse(saved);
    }

    const mnemonic = generateMnemonic(128);

    const seed = mnemonicToSeedSync(mnemonic);

    const root = bip32.fromSeed(seed, network);

    const node = root.derivePath(
        "m/84'/1'/0'/0/0"
    );

    const payment = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(node.publicKey),
        network: network
    });

    if (!payment.address) {
        throw new Error("Could not generate Bitcoin address.");
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

    return wallet;
}


// Start wallet
try {

    const wallet = loadWallet();

    console.log("Wallet generated:", wallet.address);

    document.getElementById("address").textContent =
        wallet.address;


    // QR Code
    QRCode.toCanvas(
        wallet.address,
        {
            width: 200
        },
        function(error, canvas) {

            if (error) {
                console.error("QR error:", error);
                return;
            }

            document
                .getElementById("qr")
                .replaceChildren(canvas);
        }
    );


    // Copy address
    document.getElementById("copy").onclick =
        async function() {

            await navigator.clipboard.writeText(
                wallet.address
            );

            alert("Testnet address copied.");
        };


    console.log(
        "TESTNET WALLET MNEMONIC — NEVER SHARE:",
        wallet.mnemonic
    );


} catch (error) {

    console.error(
        "WALLET GENERATION ERROR:",
        error
    );

    document.getElementById("address").textContent =
        "Wallet generation failed";

    alert(
        "Wallet generation failed. Open the browser console to see the error."
    );
}


// Balance
async function refreshBalance() {

    const balanceElement =
        document.getElementById("balance");

    balanceElement.textContent =
        "Checking...";

    try {

        const saved =
            localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            throw new Error("Wallet not found.");
        }

        const wallet =
            JSON.parse(saved);

        const response = await fetch(
            `https://blockstream.info/testnet/api/address/${wallet.address}`
        );

        if (!response.ok) {
            throw new Error(
                "Could not contact Bitcoin Testnet."
            );
        }

        const data =
            await response.json();

        const funded =
            (data.chain_stats?.funded_txo_sum || 0) +
            (data.mempool_stats?.funded_txo_sum || 0);

        const spent =
            (data.chain_stats?.spent_txo_sum || 0) +
            (data.mempool_stats?.spent_txo_sum || 0);

        const balance =
            funded - spent;

        balanceElement.textContent =
            (balance / 100000000).toFixed(8) +
            " BTC";

    } catch (error) {

        console.error(error);

        balanceElement.textContent =
            "Unable to load";
    }
}


document.getElementById("refresh").onclick =
    refreshBalance;

refreshBalance();
