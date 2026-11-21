# College Student of the Week: reading it from bulletin PDFs, which week it shows, and the banner (Home page only; "all" = every page).
# Needs pdfjs-dist 4.10.38 in tests/pj/node_modules (npm i --prefix pj pdfjs-dist@4.10.38) and a build in ../out.
import asyncio,os,json,sys
from playwright.async_api import async_playwright
T=os.path.dirname(os.path.abspath(__file__));SRC=os.path.dirname(T);REPO=os.path.dirname(SRC);SITE=SRC+'/out/'
PJ=os.environ.get('PJ',T+'/pj/node_modules/pdfjs-dist/legacy/build/')
data=json.load(open(REPO+'/data/site.json'))
for b in data['bulletins']:b.pop('cs',None)
data['bulletins']=[b for b in data['bulletins'] if b['d']<='2026-11-22']
DEMO={'2026-11-15':{'name':'Ava Bunch','school':'','addr':'210 Dan Allenn Drive\nBragaw 302-B\nRaleigh, NC 27607'},'2026-11-22':{'name':'Chloe Chappell','school':'East Carolina University','addr':'Ballard West Room 435\n940 College Hill\nGreenville, NC 27858'}}
for b in data['bulletins']:
  if b['d'] in DEMO:b['cs']=DEMO[b['d']]
PDFS={'20261115':('Ava Bunch','210 Dan Allenn Drive\nBragaw 302-B\nRaleigh, NC 27607'),'20261122':('Chloe Chappell','Ballard West Room 435\n940 College Hill\nGreenville, NC 27858'),
  '20261018':('Fletcher Tynch','Scott Hall 317-B\n940 College Hill Drive\nGreenville, NC 27858'),'20251228':('Kayelee Coppersmith','450 Ehringhaus Drive, Room 546\nChapel Hill, NC 27514'),
  '20250831':None,'20250720':None,'20231105':None}
bad=0
def check(ok,*m):
  global bad;bad+=not ok;print('OK ' if ok else 'BAD',*m)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    async def h(route):
      u=route.request.url
      if u.startswith('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/'):
        return await route.fulfill(path=PJ+u.rsplit('/',1)[1],content_type='text/javascript',headers={'access-control-allow-origin':'*'})
      if u.startswith('http://rhbc.test/'):
        rel=u[17:].split('?')[0].split('#')[0] or 'index.html'
        if rel=='data/site.json':return await route.fulfill(body=json.dumps(data),content_type='application/json')
        from urllib.parse import unquote;rel=unquote(rel)
        for base in (SITE,REPO+'/'):
          if os.path.isfile(base+rel):return await route.fulfill(path=base+rel)
        return await route.fulfill(status=404,body='nf')
      return await route.abort()
    # 1. which week shows, with a fake clock (New York time)
    for when,want in [('2026-11-15T09:00:00-05:00','Ava Bunch'),('2026-11-21T22:00:00-05:00','Ava Bunch'),('2026-11-22T00:30:00-05:00','Chloe Chappell'),('2026-11-28T23:00:00-05:00','Chloe Chappell'),('2026-11-29T08:00:00-05:00',None),('2026-11-14T12:00:00-05:00',None)]:
      c=await b.new_context(viewport={'width':1280,'height':900});await c.route('**/*',h);pg=await c.new_page()
      errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
      await pg.clock.set_fixed_time(when)
      await pg.goto('http://rhbc.test/');await pg.wait_for_timeout(600)
      got=await pg.evaluate('(()=>{const s=document.getElementById("csbar");return s.hidden?null:s.querySelector(".cs-line b").textContent})()')
      check(got==want and not errs,'week',when,got,errs);await c.close()
    # 2. reading the PDF in the bulletin dialog
    c=await b.new_context(viewport={'width':1280,'height':900});await c.route('**/*',h);pg=await c.new_page()
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://rhbc.test/');await pg.wait_for_timeout(600)
    for d,want in PDFS.items():
      f='bulletins/%s/%s RHBC Bulletin.pdf'%(d[:4],d)
      await pg.evaluate('document.querySelector("[data-add=bulletins]").click()')
      await pg.set_input_files('#d-file',REPO+'/'+f)
      await pg.wait_for_function('!/Filled in from the PDF/.test(document.getElementById("d-cs-hint").textContent)',timeout=20000)
      r=await pg.evaluate('({name:document.getElementById("d-cs-name").value,addr:document.getElementById("d-cs-addr").value,hint:document.getElementById("d-cs-hint").textContent})')
      await pg.click('#d-cancel')
      ok=(r['name']==want[0] and r['addr']==want[1]) if want else (r['name']=='' and 'No College Student' in r['hint'])
      check(ok and not errs,'pdf',d,r['name'] or '(none)',errs)
    # typed values are kept when a PDF is chosen
    await pg.evaluate('document.querySelector("[data-add=bulletins]").click()');await pg.fill('#d-cs-name','Typed Name')
    await pg.set_input_files('#d-file',REPO+'/bulletins/2026/20261115 RHBC Bulletin.pdf');await pg.wait_for_timeout(2500)
    r=await pg.evaluate('document.getElementById("d-cs-name").value');await pg.click('#d-cancel')
    check(r=='Typed Name','keeps typed name',r)
    # editing a bulletin shows its student; saving keeps it, and an empty name removes it
    await pg.evaluate('__rhbcCS.edit("2026-11-15")')
    r=await pg.evaluate('document.getElementById("d-cs-name").value+"|"+document.getElementById("d-cs-addr").value.split("\\n").length')
    check(r=='Ava Bunch|3','edit dialog fills',r)
    await pg.evaluate('document.getElementById("d-cs-name").value=""');await pg.evaluate('document.getElementById("dForm").requestSubmit()');await pg.wait_for_timeout(300)
    r=await pg.evaluate('JSON.stringify(__rhbcCS.bulletins().find(x=>x.d==="2026-11-15").cs||null)')
    check(r=='null','empty name removes student',r);await c.close()
    # 3. placements: desktop, phone and dark
    for place in ['home','all']:
      for vp,dark in [((1280,900),False),((390,844),False),((390,844),True)]:
        c=await b.new_context(viewport={'width':vp[0],'height':vp[1]},color_scheme='dark' if dark else 'light');await c.route('**/*',h);pg=await c.new_page()
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.clock.set_fixed_time('2026-11-21T15:00:00-05:00')
        await pg.goto('http://rhbc.test/');await pg.wait_for_timeout(600)
        if place!='home':await pg.evaluate(f'__rhbcCS.set({{place:"{place}"}})')
        await pg.click('#csbar .cs-btn')
        await pg.wait_for_timeout(150)
        ov=await pg.evaluate('document.documentElement.scrollWidth>innerWidth')
        tag='%s_%d%s'%(place,vp[0],'_dark' if dark else '')
        await pg.screenshot(path=T+'/shots/cs_'+tag+'.png')
        addr=await pg.evaluate('!document.querySelector("#csbar .cs-addr").hidden')
        await pg.goto('http://rhbc.test/#calendar');await pg.wait_for_timeout(300)
        other=await pg.evaluate('getComputedStyle(document.getElementById("csbar")).display!=="none"&&!document.getElementById("csbar").hidden')
        check(addr and not ov and not errs and other==(place=='all'),'place',tag,'overflow' if ov else '','on other pages' if other else '',errs);await c.close()
    await b.close();print('FAILURES',bad);sys.exit(1 if bad else 0)
asyncio.run(main())
