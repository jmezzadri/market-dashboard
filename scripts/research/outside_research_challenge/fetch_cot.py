"""Pull the full CFTC history used by trend_vs_positioning.py. Public data, no key."""
import json, urllib.request, urllib.parse
def pull(dataset, code, fields):
    out=[]; off=0
    while True:
        q={"$select":",".join(fields),"$where":f"cftc_contract_market_code='{code}'","$order":"report_date_as_yyyy_mm_dd","$limit":"5000","$offset":str(off)}
        u=f"https://publicreporting.cftc.gov/resource/{dataset}.json?"+urllib.parse.urlencode(q)
        rows=json.load(urllib.request.urlopen(u,timeout=60))
        out+=rows; off+=5000
        if len(rows)<5000: break
    return out
D={}
for name,code in (("wheat","001602"),("corn","002602"),("soybeans","005602")):
    r=pull("72hh-3qpy",code,["report_date_as_yyyy_mm_dd","open_interest_all","m_money_positions_long_all","m_money_positions_short_all"])
    D[name]=[[x["report_date_as_yyyy_mm_dd"][:10],(float(x["m_money_positions_long_all"])-float(x["m_money_positions_short_all"]))/float(x["open_interest_all"])] for x in r if float(x.get("open_interest_all",0) or 0)>0]
r=pull("6dca-aqww","099741",["report_date_as_yyyy_mm_dd","open_interest_all","noncomm_positions_long_all","noncomm_positions_short_all"])
D["euro"]=[[x["report_date_as_yyyy_mm_dd"][:10],(float(x["noncomm_positions_long_all"])-float(x["noncomm_positions_short_all"]))/float(x["open_interest_all"])] for x in r if float(x.get("open_interest_all",0) or 0)>0]
for k,v in D.items(): print(k,len(v),v[0][0],v[-1])
json.dump(D,open("cot_history.json","w"))
