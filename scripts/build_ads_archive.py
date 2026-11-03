import json,re,datetime as dt
li=json.load(open('linkedin_raw.json'))['data']; go=json.load(open('google_raw.json'))['data']
SEN=re.compile(r'senior|demand ?gen|youtube',re.I)
def path(u):
    if not u: return ""
    u=u.split('?')[0]; return u
groups={}
for r in li:
    if SEN.search((r['campaign_group_name'] or '')+' '+(r['campaign'] or '')): continue
    g=(r['campaign_group_name'] or '').strip(); c=(r['campaign'] or '').strip()
    a={"id":r['creative_id'],"title":re.sub(r'\s+',' ',(r['share_title'] or '')).strip(),"status":r['creative_status'],"landing":path(r['landing_page']),
       "thumb":r.get('creative_thumbnail') or "","impr":int(r['impressions'] or 0),"clicks":int(r['clicks'] or 0)}
    groups.setdefault(g,{}).setdefault(c,[]).append(a)
LI=[]
for g,cs in groups.items():
    camps=[{"campaign":c,"ads":sorted(ads,key=lambda a:(a['status']!='ACTIVE',-a['impr']))} for c,ads in cs.items()]
    camps.sort(key=lambda c:-sum(a['impr'] for a in c['ads']))
    LI.append({"group":g,"campaigns":camps})
LI.sort(key=lambda g:(not any(a['status']=='ACTIVE' for c in g['campaigns'] for a in c['ads']), -sum(a['impr'] for c in g['campaigns'] for a in c['ads'])))
def texts(s):
    try: return [x['text'] for x in json.loads(s)] if s else []
    except Exception: return []
def url(s):
    try: v=json.loads(s); return v[0] if isinstance(v,list) and v else str(v)
    except Exception: return s or ""
camp={}
for r in go:
    if SEN.search(r['campaign']): continue
    on = r['ad_group_ad_status']=='ENABLED' and r['campaign_status']=='ENABLED'
    a={"id":r['ad_id'],"headlines":texts(r['ad_responsive_search_ad_headlines']),"descriptions":texts(r['ad_responsive_search_ad_descriptions']),
       "url":path(url(r['ad_final_urls'])),"status":"ENABLED" if on else "PAUSED","strength":r.get('ad_strength') or "","impr":int(r['impressions'] or 0),"clicks":int(r['clicks'] or 0)}
    camp.setdefault(r['campaign'],{}).setdefault(r['ad_group_name'],[]).append(a)
GO=[{"campaign":c,"shared":bool(re.search('brand|national general',c,re.I)),"adGroups":sorted([{"adGroup":g,"ads":ads} for g,ads in gs.items()],key=lambda x:-sum(a['impr'] for a in x['ads']))} for c,gs in camp.items()]
GO.sort(key=lambda c:(not any(a['status']=='ENABLED' for g in c['adGroups'] for a in g['ads']), c['campaign']))
out={"updated":"Nov 3, 2026","window":"Jan 1 to Nov 2, 2026","note":"Healthcare and shared campaigns. Senior living, DemandGen and YouTube are left out.","linkedin":LI,"google":GO}
json.dump(out,open('/home/claude/site/public/data/ads-archive.json','w'),ensure_ascii=False,separators=(',',':'))
print('LI groups',len(LI),'ads',sum(len(c['ads']) for g in LI for c in g['campaigns']),'active',sum(a['status']=='ACTIVE' for g in LI for c in g['campaigns'] for a in c['ads']))
print('GO camps',len(GO),'ads',sum(len(g['ads']) for c in GO for g in c['adGroups']),'enabled',sum(a['status']=='ENABLED' for c in GO for g in c['adGroups'] for a in g['ads']))
print(GO[0]['campaign'], GO[0]['adGroups'][0]['adGroup'], GO[0]['adGroups'][0]['ads'][0]['headlines'][:3], GO[0]['adGroups'][0]['ads'][0]['url'])
import os; print(os.path.getsize('/home/claude/site/public/data/ads-archive.json'))
