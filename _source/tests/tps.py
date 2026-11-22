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
      if u.startswith('https://api.github.com/repos/RockyHockBaptistChurch/rhbc-website'):
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
        return await route.fulfill(path=D+'pj/node_modules/pdfjs-dist/legacy/build/'+u.rsplit('/',1)[1],content_type='text/javascript',headers={'access-control-allow-origin':'*'})
      if 'vimeo.com' in u: return await route.fulfill(body='<body style="background:#222;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Vimeo live player</body>',content_type='text/html')
      return await route.abort()
    ctx=await b.new_context(viewport={'width':1280,'height':900});await ctx.route('**/*',handler);pg=await ctx.new_page()
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    li='(r)=>[...document.querySelectorAll("[data-route="+r+"] [data-pagesched] li")].map(l=>l.innerText.replace(/\\s+/g," ").trim())'
    await pg.goto('http://rhbc.test/#kids');await pg.wait_for_timeout(900)
    print('kids',await pg.evaluate(li,'kids'))
    print('cards',await pg.evaluate('[...document.querySelectorAll("[data-route=kids] .cards .card")].map(c=>c.innerText.replace(/\\s+/g," "))'))
    print('sup',await pg.evaluate('[...document.querySelectorAll("[data-route=kids] sup.ord")].length'))
    await pg.goto('http://rhbc.test/#students');await pg.wait_for_timeout(500)
    print('students',await pg.evaluate(li,'students'))
    await pg.click('#staffLink');await pg.fill('#gh-key','GOODKEY');await pg.click('#gh-go');await pg.wait_for_timeout(1500)
    await pg.goto('http://rhbc.test/#kids');await pg.wait_for_timeout(700)
    await pg.set_viewport_size({'width':390,'height':844})
    await pg.click('[data-route=kids] .ps-edit');await pg.wait_for_timeout(300)
    await pg.screenshot(path='/home/claude/ps-dialog-1.png')
    await pg.evaluate('document.querySelectorAll("#psList .ps-row")[1].scrollIntoView({block:"start"})');await pg.wait_for_timeout(150)
    await pg.screenshot(path='/home/claude/ps-dialog-2.png')
    # change GAs line to custom wording
    r='#psList .ps-row:nth-child(4)'
    await pg.check(r+' input[value=custom]');await pg.fill(r+' .ps-note','1st – 5th Grade Girls and Boys')
    await pg.click('#psForm button[type=submit]');await pg.wait_for_timeout(400)
    print('kids after',await pg.evaluate(li,'kids'))
    await pg.set_viewport_size({'width':1280,'height':900})
    await pg.click('#saveBtn');await pg.wait_for_timeout(2000)
    for bd in blobs:
      try:
        d=json.loads(base64.b64decode(bd['content']).decode() if bd.get('encoding')=='base64' else bd['content'])
        print('saved kids',[ (x['wid'],x.get('custom',False),x.get('note','')) for x in d['pageSched']['kids']])
      except Exception as e: pass
    print('errs',errs)
    await b.close()
asyncio.run(main())
