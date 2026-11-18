import { handleAuthProxyRequest } from '@neondatabase/auth/server';
import { authProxyRoute } from '../core/auth-proxy-route.mjs';

const AUTH_UPSTREAM='https://ep-proud-poetry-bd2f21s9.neonauth.c-8.us-east-2.aws.neon.tech/quercus_pocket/auth';
const MAX_BYTES=64*1024;
const NEVER_CACHE={'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};

export default {
  async fetch(request) {
    const url=new URL(request.url);
    const route=authProxyRoute(url.toString());
    if(!route)return new Response('Invalid authentication path',{status:400,headers:NEVER_CACHE});
    if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:NEVER_CACHE});
    const cookieSecret=process.env.NEON_AUTH_COOKIE_SECRET;
    if(!cookieSecret || cookieSecret.length<32)return new Response('Authentication unavailable',{status:503,headers:NEVER_CACHE});

    const declared=Number(request.headers.get('content-length')||0);
    if(!Number.isFinite(declared)||declared>MAX_BYTES)return new Response('Request too large',{status:413,headers:NEVER_CACHE});
    let body;
    if(request.method==='POST'){
      body=await request.arrayBuffer();
      if(body.byteLength>MAX_BYTES)return new Response('Request too large',{status:413,headers:NEVER_CACHE});
    }
    // The browser sees an exclusively same-origin cookie. Neon Auth's official
    // proxy toolkit sanitizes Set-Cookie flags and forwards authorized requests
    // to the fixed upstream. It never exposes the upstream cookie domain.
    const pathUrl=new URL('/auth/'+route.path+(route.query?'?'+route.query:''),url.origin);
    const headers=new Headers(request.headers);
    headers.delete('host');headers.delete('content-length');headers.delete('transfer-encoding');
    headers.delete('x-forwarded-host');headers.delete('x-forwarded-proto');
    const proxied=new Request(pathUrl,{
      method:request.method,headers,body:request.method==='POST'?body:undefined,
      redirect:'manual'
    });
    try{
      const response=await handleAuthProxyRequest({
        request:proxied,path:route.path,
        baseUrl:AUTH_UPSTREAM,cookieSecret,sameSite:'lax',
      });
      const safeHeaders=new Headers(response.headers);
      for(const [k,v] of Object.entries(NEVER_CACHE))safeHeaders.set(k,v);
      return new Response(response.body,{
        status:response.status,headers:safeHeaders
      });
    }catch{
      // Never log request bodies, cookies or tokens.
      return Response.json({message:'Authentication provider is temporarily unavailable.'},{
        status:502,headers:NEVER_CACHE
      });
    }
  }
};
