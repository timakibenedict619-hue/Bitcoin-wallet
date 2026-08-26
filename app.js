from pathlib import Path

project = Path("/mnt/data/bitcoin-testnet-wallet")
project.mkdir(exist_ok=True)

index = project / "index.html"
html = index.read_text(encoding="utf-8")
html = html.replace(
'''<p class="muted">Sending is intentionally disabled in this first safe version.</p>
    <input id="recipient" placeholder="Testnet BTC address" disabled>
    <input id="amount" type="number" step="0.00000001" placeholder="BTC amount" disabled>
    <button disabled>Send BTC</button>''',
'''<p class="muted">Send Testnet BTC to another Testnet address. Never enter a Mainnet address.</p>
    <input id="recipient" placeholder="Testnet BTC address">
    <input id="amount" type="number" step="0.00000001" min="0" placeholder="BTC amount">
    <button id="send">Send Testnet BTC</button>
    <div id="sendResult" class="muted small"></div>'''
)
index.write_text(html, encoding="utf-8")

app = project / "app.js"
js = r'''import * as bitcoin from "https://esm.sh/bitcoinjs-lib@6.1.7";
import * as ecc from "https://esm.sh/tiny-secp256k1@2.2.3";
import { BIP32Factory } from "https://esm.sh/bip32@4.0.0";
import { mnemonicToSeedSync, generateMnemonic } from "https://esm.sh/bip39@3.1.0";
import QRCode from "https://esm.sh/qrcode@1.5.4";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const network = bitcoin.networks.testnet;

const KEY = "demo_testnet_wallet_v1";
const SATOSHIS = 100000000;
const API = "https://blockstream.info/testnet/api";

function loadWallet(){
  const saved = localStorage.getItem(KEY);
  if(saved) return JSON.parse(saved);

  const mnemonic = generateMnemonic(128);
  const seed = mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network);
  const node = root.derivePath("m/84'/1'/0'/0/0");
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(node.publicKey),
    network
  });

  const wallet = {
    mnemonic,
    address: payment.address,
    privateKeyHex: Buffer.from(node.privateKey).toString("hex")
  };

  localStorage.setItem(KEY, JSON.stringify(wallet));
  return wallet;
}

const wallet = loadWallet();
document.querySelector("#address").textContent = wallet.address;

QRCode.toCanvas(wallet.address, {width:200}, (err, canvas)=>{
  if(err) return console.error(err);
  document.querySelector("#qr").replaceChildren(canvas);
});

document.querySelector("#copy").onclick = async ()=>{
  await navigator.clipboard.writeText(wallet.address);
  alert("Testnet address copied.");
};

async function getBalanceAndUtxos(){
  const [addrRes, utxoRes] = await Promise.all([
    fetch(`${API}/address/${wallet.address}`),
    fetch(`${API}/address/${wallet.address}/utxo`)
  ]);

  if(!addrRes.ok || !utxoRes.ok) {
    throw new Error("Could not read the Testnet blockchain.");
  }

  const addr = await addrRes.json();
  const utxos = await utxoRes.json();

  const funded =
    (addr.chain_stats?.funded_txo_sum || 0) +
    (addr.mempool_stats?.funded_txo_sum || 0);

  const spent =
    (addr.chain_stats?.spent_txo_sum || 0) +
    (addr.mempool_stats?.spent_txo_sum || 0);

  return {
    balance: funded - spent,
    utxos
  };
}

async function refresh(){
  const el = document.querySelector("#balance");
  el.textContent = "Checking…";

  try{
    const {balance} = await getBalanceAndUtxos();
    el.textContent = (balance / SATOSHIS).toFixed(8) + " BTC";
  }catch(e){
    console.error(e);
    el.textContent = "Unable to load";
  }
}

function isValidTestnetAddress(address){
  try{
    bitcoin.address.toOutputScript(address.trim(), network);
    return true;
  }catch{
    return false;
  }
}

function chooseUtxos(utxos, needed){
  // Simple largest-first selection for this learning/testnet wallet.
  const sorted = [...utxos].sort((a,b) => b.value - a.value);
  const selected = [];
  let total = 0;

  for(const u of sorted){
    selected.push(u);
    total += u.value;
    if(total >= needed) break;
  }

  return {selected, total};
}

async function sendTestnetBTC(){
  const button = document.querySelector("#send");
  const result = document.querySelector("#sendResult");
  const recipient = document.querySelector("#recipient").value.trim();
  const amountText = document.querySelector("#amount").value.trim();

  result.textContent = "";

  if(!recipient){
    result.textContent = "Enter a Testnet Bitcoin address.";
    return;
  }

  if(!isValidTestnetAddress(recipient)){
    result.textContent = "Invalid Testnet Bitcoin address.";
    return;
  }

  const amountBTC = Number(amountText);

  if(!Number.isFinite(amountBTC) || amountBTC <= 0){
    result.textContent = "Enter a valid BTC amount.";
    return;
  }

  const amount = Math.round(amountBTC * SATOSHIS);

  // Demo fee. Real fee estimation should use current mempool conditions.
  const fee = 1000;

  button.disabled = true;
  result.textContent = "Preparing transaction…";

  try{
    const {utxos} = await getBalanceAndUtxos();

    const {selected, total} = chooseUtxos(utxos, amount + fee);

    if(total < amount + fee){
      throw new Error("Insufficient Testnet BTC for the amount plus network fee.");
    }

    const change = total - amount - fee;

    const psbt = new bitcoin.Psbt({network});

    for(const u of selected){
      const txHex = await fetch(`${API}/tx/${u.txid}/hex`).then(r=>{
        if(!r.ok) throw new Error("Could not retrieve an input transaction.");
        return r.text();
      });

      const payment = bitcoin.payments.p2wpkh({
        address: wallet.address,
        network
      });

      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: {
          script: payment.output,
          value: u.value
        },
        nonWitnessUtxo: Buffer.from(txHex, "hex")
      });
    }

    psbt.addOutput({
      address: recipient,
      value: amount
    });

    if(change > 0){
      psbt.addOutput({
        address: wallet.address,
        value: change
      });
    }

    const node = bip32.fromPrivateKey(
      Buffer.from(wallet.privateKeyHex, "hex"),
      Buffer.alloc(32),
      network
    );

    for(let i=0; i<selected.length; i++){
      psbt.signInput(i, node);
    }

    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();

    result.textContent = "Broadcasting transaction…";

    const broadcast = await fetch(`${API}/tx`, {
      method: "POST",
      headers: {"Content-Type": "text/plain"},
      body: txHex
    });

    const responseText = await broadcast.text();

    if(!broadcast.ok){
      throw new Error(responseText || "Bitcoin Testnet rejected the transaction.");
    }

    result.innerHTML =
      `Sent successfully. Transaction ID:<br><strong>${responseText}</strong>`;

    document.querySelector("#recipient").value = "";
    document.querySelector("#amount").value = "";
    await refresh();

  }catch(error){
    console.error(error);
    result.textContent = "Send failed: " + error.message;
  }finally{
    button.disabled = false;
  }
}

document.querySelector("#refresh").onclick = refresh;
document.querySelector("#send").onclick = sendTestnetBTC;

refresh();

console.log(
  "TESTNET WALLET MNEMONIC — NEVER SHARE:",
  wallet.mnemonic
);
'''
app.write_text(js, encoding="utf-8")

print("Updated:", index)
print("Updated:", app)
