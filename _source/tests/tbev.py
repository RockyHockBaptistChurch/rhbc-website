import asyncio,datetime,json,json,base64,os
from playwright.async_api import async_playwright
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'')
SITE=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'out','')
puts=[];blobs=[];trees=[];commits=[];refs=[]
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    async def handler(route):
      req=route.request;u=req.url
      if u.startswith('https://api.github.com/repos/hctynch/rhbc-website'):
        auth=req.headers.get('authorization','')
        if auth!='Bearer GOODKEY': return await route.fulfill(status=401,body='{}',content_type='application/json')
        path=u.split('rhbc-website',1)[1]
        if req.method=='GET' and path=='': return await route.fulfill(body=json.dumps({'permissions':{'push':True}}),content_type='application/json')
        if req.method=='GET' and path.startswith('/git/ref/heads/main'): return await route.fulfill(body=json.dumps({'object':{'sha':'head1'}}),content_type='application/json')
        if req.method=='GET' and path.startswith('/git/commits/'): return await route.fulfill(body=json.dumps({'tree':{'sha':'tree1'}}),content_type='application/json')
        if req.method=='GET' and path.startswith('/contents/') and not path.startswith('/contents/data/site.json'): return await route.fulfill(status=404,body='{}',content_type='application/json')
        if req.method=='POST' and path=='/git/blobs':
          bd=json.loads(req.post_data);blobs.append(bd);return await route.fulfill(status=201,body=json.dumps({'sha':'b%d'%len(blobs)}),content_type='application/json')
        if req.method=='POST' and path=='/git/trees':
          bd=json.loads(req.post_data);trees.append(bd);return await route.fulfill(status=201,body=json.dumps({'sha':'tree2'}),content_type='application/json')
        if req.method=='POST' and path=='/git/commits':
          bd=json.loads(req.post_data);commits.append(bd);return await route.fulfill(status=201,body=json.dumps({'sha':'c2'}),content_type='application/json')
        if req.method=='PATCH':
          refs.append(json.loads(req.post_data));return await route.fulfill(body='{}',content_type='application/json')
        if req.method=='GET' and path.startswith('/contents/data/site.json'):
          c=base64.b64encode(open(SITE+'data/site.json','rb').read()).decode()
          return await route.fulfill(body=json.dumps({'content':c,'sha':'sha1'}),content_type='application/json')
        if req.method=='PUT':
          bd=json.loads(req.post_data);puts.append((path,bd.get('sha'),bd['message'],len(bd['content'])))
          if path.endswith('site.json'):
            open(D+'shots/saved-site.json','wb').write(base64.b64decode(bd['content']))
          return await route.fulfill(status=201,body=json.dumps({'content':{'sha':'sha2','path':path}}),content_type='application/json')
        return await route.fulfill(status=404,body='{}')
      if u.startswith('http://rhbc.test/'):
        rel=u[len('http://rhbc.test/'):].split('?')[0].split('#')[0] or 'index.html'
        fp=SITE+rel
        if os.path.isfile(fp):
          ct={'html':'text/html','json':'application/json','png':'image/png','jpg':'image/jpeg'}.get(rel.rsplit('.',1)[-1],'application/octet-stream')
          return await route.fulfill(path=fp,content_type=ct)
        return await route.fulfill(status=404,body='nf')
      if u.startswith('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/'):
        return await route.fulfill(path=os.environ.get('PDFJS','/home/claude/work/pdfjsdist/package/legacy/build/')+u.rsplit('/',1)[1],content_type='text/javascript',headers={'access-control-allow-origin':'*'})
      if 'vimeo.com' in u: return await route.fulfill(body='<body style="background:#222;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Vimeo live player</body>',content_type='text/html')
      return await route.abort()
    PDF=os.environ.get('BPDF',os.path.join(os.path.dirname(os.path.dirname(D)),'..','bulletins','2026','20261108 RHBC Bulletin.pdf'))
    BD=os.environ.get('BDATE','2026-11-08')
    for vw,tag,dark in [((1280,900),'d',False),((390,844),'p',False),((390,844),'pd',True)]:
      blobs.clear()
      ctx=await b.new_context(viewport={'width':vw[0],'height':vw[1]},color_scheme='dark' if dark else 'light');await ctx.route('**/*',handler);pg=await ctx.new_page()
      errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
      await pg.goto('http://rhbc.test/#bulletins');await pg.wait_for_timeout(900)
      await pg.click('#staffLink');await pg.fill('#gh-key','GOODKEY');await pg.click('#gh-go');await pg.wait_for_timeout(1500)
      await pg.goto('http://rhbc.test/#bulletins');await pg.wait_for_timeout(500)
      await pg.click('[data-add=bulletins]');await pg.wait_for_timeout(300)
      await pg.fill('#d-date',BD);await pg.set_input_files('#d-file',PDF);await pg.wait_for_timeout(2500)
      await pg.click('#d-apply');await pg.wait_for_selector('.bs-row,.bs-sec,#g-body .dialog-actions',timeout=20000);await pg.wait_for_timeout(500)
      info=await pg.evaluate("""[...document.querySelectorAll('#g-body .bs-row')].map(r=>(r.querySelector('input').checked?'[x] ':'[ ] ')+r.querySelector('.bs-txt').innerText.replace(/\\n/g,' | ')+(r.querySelector('.bs-maybe')?'  ?? '+r.querySelector('.bs-maybe').innerText:''))""")
      folds=await pg.evaluate("[...document.querySelectorAll('#g-body summary')].map(s=>s.textContent)")
      if tag=='d':
        print('\n'.join(info));print(folds)
      sw=await pg.evaluate('document.documentElement.scrollWidth');dw=await pg.evaluate("document.querySelector('#overlay16 .dialog').getBoundingClientRect().width")
      await pg.screenshot(path=D+'shots/bev_%s.png'%tag,full_page=False)
      # edit the first row
      await pg.locator('#g-body .bs-row .bs-acts button',has_text='Edit').first.click();await pg.wait_for_timeout(200)
      await pg.locator('#g-body .bs-row .bs-edit input[type=text]').first.fill('Edited Title Test')
      await pg.locator('#g-body .bs-row').first.screenshot(path=D+'shots/bev_edit_%s.png'%tag)
      # don't suggest again on the last "new" row
      n0=await pg.locator('#g-body .bs-row').count()
      await pg.locator('#g-body .bs-sec').first.locator('.bs-row').last.locator('button',has_text='Suggest Again').click();await pg.wait_for_timeout(300)
      n1=await pg.locator('#g-body .bs-row').count()
      btn=await pg.locator('#g-body .dialog-actions .btn.primary').inner_text()
      await pg.locator('#g-body .dialog-actions .btn.primary').click();await pg.wait_for_timeout(500)
      toast=await pg.evaluate("(document.querySelector('.toast')||{}).textContent||''")
      await pg.click('#saveBtn');await pg.wait_for_timeout(1500)
      saved=None
      for bl in blobs:
        try:
          t=base64.b64decode(bl['content']).decode() if bl.get('encoding')=='base64' else bl['content']
          if t.lstrip().startswith('{') and '"events"' in t: saved=json.loads(t)
        except Exception as e: pass
      ev=[e for e in (saved or {}).get('events',[]) if e['id'] not in ORIG]
      print(tag,'rows',n0,'->',n1,'|',btn,'|',toast,'| scrollW',sw,'dialogW',round(dw),'| new events',len(ev),[(e['date'],e.get('start'),e['title'],e.get('loc'),e.get('attach'),e.get('cats'),e.get('auds')) for e in ev][:4],'| skip',(saved or {}).get('bulletinSkip'),'| errs',errs)
      await ctx.close()
    await b.close()
ORIG=set(e['id'] for e in json.load(open(SITE+'data/site.json'))['events'])
asyncio.run(main())
