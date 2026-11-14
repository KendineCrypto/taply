#!/usr/bin/env python3
"""Read-only: verify Mainnet transactions by hash (FINAL outcome) and sum what the signer really spent.

usage: python3 verify-mainnet-txs.py <signer.near> <txHash> [<txHash> ...]
Spent = gas burnt by the transaction and its receipts + deposits that did not come back to the signer
(transfers to other accounts, storage bonds, fees). Refunds/returns to the signer are subtracted.
No key, no signing: only RPC reads (EXPERIMENTAL_tx_status, wait_until FINAL).
"""
import json, sys, urllib.request
RPC = 'https://rpc.mainnet.fastnear.com'
def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=30))
signer, hashes = sys.argv[1], sys.argv[2:]
total = 0
for h in hashes:
    r = rpc('EXPERIMENTAL_tx_status', {'tx_hash': h, 'sender_account_id': signer, 'wait_until': 'FINAL'})
    if 'error' in r:
        print(f'{h}: NOT FINAL / UNKNOWN -> {r["error"].get("cause", r["error"])}  (do not resend)'); continue
    res = r['result']; st = res['status']
    ok = 'SuccessValue' in st or 'SuccessReceiptId' in st
    burnt = int(res['transaction_outcome']['outcome']['tokens_burnt']) + sum(int(o['outcome']['tokens_burnt']) for o in res['receipts_outcome'])
    deposit = sum(int(a.get('Transfer', {}).get('deposit', 0)) + int(a.get('FunctionCall', {}).get('deposit', 0)) for a in res['transaction']['actions'])
    returned = 0
    for rc in res.get('receipts', []):
        if rc.get('receiver_id') == signer and rc.get('predecessor_id') != 'system':
            for a in rc['receipt'].get('Action', {}).get('actions', []):
                if isinstance(a, dict) and 'Transfer' in a: returned += int(a['Transfer']['deposit'])
    spent = burnt + deposit - returned
    total += spent
    print(f'{h}: {"SUCCESS" if ok else "FAILURE"} final={res.get("final_execution_status")} receiver={res["transaction"]["receiver_id"]} '
          f'deposit={deposit/1e24:.6f} returned={returned/1e24:.6f} gas_burnt={burnt/1e24:.6f} net_spent={spent/1e24:.6f} NEAR')
print(f'TOTAL net spent by {signer}: {total/1e24:.6f} NEAR (budget 0.1)')
