import {readFile,writeFile} from 'node:fs/promises';
import {createPublicKey,createHash,sign} from 'node:crypto';
// The signing key lives outside this repository. Never print or commit it.
const keyPath=process.env.AER_PLUGINS_SIGNING_KEY;
if(!keyPath)throw new Error('Set AER_PLUGINS_SIGNING_KEY to a private PEM outside the repository');
const key=await readFile(keyPath);
const jwk=createPublicKey(key).export({format:'jwk'});
const publicBytes=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
const keyId=createHash('sha256').update(publicBytes).digest('hex').slice(0,16);
const now=Math.floor(Date.now()/1000);
const payload=Buffer.from(JSON.stringify({schema:2,channel:'stable',sequence:now,issuedAt:now,expiresAt:now+180*86400,apps:JSON.parse(await readFile(new URL('../dist/releases.json',import.meta.url)))}));
const envelope={keyId,payload:payload.toString('base64'),signature:sign('sha256',payload,key).toString('base64')};
await writeFile(new URL('../catalog/stable.json',import.meta.url),JSON.stringify(envelope,null,2)+'\n');
await writeFile(new URL('../catalog/trust.json',import.meta.url),JSON.stringify({[keyId]:publicBytes.toString('base64')},null,2)+'\n');
console.log('Signed catalog with public key ID '+keyId);
