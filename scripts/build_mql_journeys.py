import json,re,sys,datetime as dt
sys.path.insert(0,'.')
from hubspot import LEADS,C
J={x['domain']:x for x in json.load(open('batch1.json'))+[json.load(open('b_chi.json'))]+json.load(open('batch2.json'))+json.load(open('batch3.json'))}
D=lambda s:dt.date.fromisoformat(s)
def clean(s):
    s=str(s).replace('—',',').replace('–',',').replace(' , ',', ')
    s=re.sub(r'\bto [A-Z]\. ?[A-Z][a-z]+:','',s); s=re.sub(r'\bto contact:?','',s); s=re.sub(r'\s{2,}',' ',s).strip(' :,')
    return s
CH={"LinkedIn ad view":"LinkedIn ad view","LinkedIn ad click":"LinkedIn ad click","Google Ads":"Google Ads visit","Bing Ads":"Bing Ads visit","Sales email":"Sales email sent","Email":"Email visit","Organic search":"Organic search visit","Direct":"Direct visit","Form fill":"Form fill","Meeting":"Meeting"}
out=[]
for dom,(name,cid,mql,label) in LEADS.items():
    j=J[dom]; c=j['counts']; md=D(mql); cut12=md-dt.timedelta(days=365)
    tl=[t for t in j.get('timeline',[]) if not re.search('senior',t['what'],re.I)]
    before=[t for t in tl if D(t['date'])<=md]
    contacts=C.get(dom,[])
    opens=[x for x in contacts if x[1] and cut12<=D(x[1])<=md]
    eclicks=[x for x in contacts if x[2] and cut12<=D(x[2])<=md]
    sclicks=[x for x in contacts if x[3] and cut12<=D(x[3])<=md]
    touches={
      "liView": (c.get('linkedin_ad_views',0) or 0)>0,
      "liClick": c.get('linkedin_ad_clicks',0),
      "google": c.get('google_ad_sessions',0)+c.get('bing_ad_sessions',0),
      "pages": c.get('page_views',0),
      "emailOpen": len(opens), "emailClick": len(eclicks)+c.get('email_clicks',0),
      "salesSent": c.get('sales_emails',0), "salesClick": len(sclicks),
      "forms": c.get('form_fills',0)+0, "visitors": c.get('known_visitors',0)}
    active=[]
    if touches['liClick']: active.append('LinkedIn ad clicks')
    if touches['google']: active.append('Google Ads visits')
    if touches['pages']: active.append('Website visits')
    if touches['emailClick']: active.append('Email clicks')
    if touches['salesClick']: active.append('Sales email clicks')
    if touches['forms']: active.append('Form fills')
    ft=j.get('first_touch'); lt=before[0] if before else None
    out.append({"company":name,"domain":dom,"hubspotId":cid,"mql":mql,"label":label,
      "titles":[x[0] for x in contacts][:4],"contacts":len(contacts),
      "touches":touches,"active":active,
      "first":{"date":ft['date'],"channel":CH.get(ft['channel'],ft['channel'])} if ft else None,
      "lastBefore":{"date":lt['date'],"channel":CH.get(lt['channel'],lt['channel'])} if lt else None,
      "campaigns":[re.sub(r'^Awareness \| Healthcare \| ','',x).strip() for x in j.get('campaigns',[]) if not re.search('senior|demandgen',x,re.I)][:4],
      "timeline":[{"date":t['date'],"channel":CH.get(t['channel'],t['channel']),"what":clean(t['what'])} for t in before[:6]]})
out.sort(key=lambda x:(x['mql'],x['company']),reverse=True)
n=len(out)
def cnt(f): return sum(1 for x in out if f(x))
summ={"n":n,"window":"Factors: 180 days before the MQL date. HubSpot email: 12 months.",
 "liReached":cnt(lambda x:x['touches']['liView']),"liClicked":cnt(lambda x:x['touches']['liClick']>0),
 "google":cnt(lambda x:x['touches']['google']>0),"site":cnt(lambda x:x['touches']['pages']>0),
 "email":cnt(lambda x:x['touches']['emailOpen']>0 or x['touches']['emailClick']>0),"emailClick":cnt(lambda x:x['touches']['emailClick']>0),
 "salesSent":cnt(lambda x:x['touches']['salesSent']>0),"salesClick":cnt(lambda x:x['touches']['salesClick']>0),
 "active":cnt(lambda x:x['active']),"adsOnly":cnt(lambda x:not x['active'] and x['touches']['liView']),
 "anyAd":cnt(lambda x:x['touches']['liView'] or x['touches']['google']>0)}
fc={}
for x in out:
    if x['first']: fc[x['first']['channel']]=fc.get(x['first']['channel'],0)+1
summ['firstTouch']=fc
lc={}
for x in out:
    if x['lastBefore']: lc[x['lastBefore']['channel']]=lc.get(x['lastBefore']['channel'],0)+1
summ['lastTouch']=lc
json.dump({"month":"2026-10","summary":summ,"companies":out},open('journeys_2026-10.json','w'),indent=1)
print(json.dumps(summ,indent=1))
for x in out: print(x['company'][:30].ljust(31),x['label'],x['active'],x['first'] and x['first']['channel'],'|',x['lastBefore'] and x['lastBefore']['channel'])
