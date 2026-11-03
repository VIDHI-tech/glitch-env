import {CloudflareMediaProvider,type MediaProvider,type ObjectMediaProvider,type VideoMediaProvider} from './media-provider.js';
import {R2HlsProvider} from './hls-provider.js';

export type VideoKind='cloudflare-stream'|'r2-hls';
export type MediaServices={
 readonly defaultVideoKind:VideoKind|null;
 readonly object:ObjectMediaProvider|null;
 readonly hasVideo:boolean;
 video(kind:VideoKind):VideoMediaProvider|null;
 failure(kind:VideoKind):string|undefined;
};

export function singleMediaServices(provider:MediaProvider|null):MediaServices{
 return {
  get defaultVideoKind(){return provider?.videoKind??'cloudflare-stream';},
  get object(){return provider;},get hasVideo(){return !!provider;},
  video(kind){return provider&&(provider.videoKind??'cloudflare-stream')===kind?provider:null;},
  failure(){return undefined;}
 };
}

export function configuredMediaServices():MediaServices{
 const videos:Partial<Record<VideoKind,VideoMediaProvider>>={},errors:Partial<Record<VideoKind,string>>={};
 const defaultVideoKind:VideoKind=process.env.VIDEO_PROVIDER==='r2-hls'?'r2-hls':'cloudflare-stream';
 if(process.env.CLOUDFLARE_ACCOUNT_ID){try{videos['cloudflare-stream']=new CloudflareMediaProvider();}catch(error){errors['cloudflare-stream']=String(error);}}
 if(defaultVideoKind==='r2-hls'||process.env.ENABLE_R2_HLS==='1'){try{videos['r2-hls']=new R2HlsProvider();}catch(error){errors['r2-hls']=String(error);}}
 if(defaultVideoKind==='cloudflare-stream'&&!process.env.CLOUDFLARE_ACCOUNT_ID)errors['cloudflare-stream']='Cloudflare Stream credentials are not configured';
 const object=(videos['r2-hls']??videos['cloudflare-stream']??null) as ObjectMediaProvider|null;
 return {defaultVideoKind,object,hasVideo:!!videos['cloudflare-stream']||!!videos['r2-hls'],video:kind=>videos[kind]??null,failure:kind=>errors[kind]};
}
