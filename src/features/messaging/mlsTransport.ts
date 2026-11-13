import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import { chitchatCore, type DevicePublicBundle } from "../../native/chitchatCore";
import { createTextMessageContent, validateMessageContentShape, type MessageContent } from "./content";
import { loadEncryptedMessages, sendEncryptedMessage, type EncryptedMessageRecord } from "./service";

function client(){if(!supabase)throw new Error("ChitChat Supabase is not configured.");return supabase;}
async function currentUser(){const {data,error}=await client().auth.getUser();if(error)throw error;if(!data.user)throw new Error("Sign in before using MLS messaging.");return data.user;}

export async function publishMyMlsDevice():Promise<{deviceId:string;bundle:DevicePublicBundle;keyPackage:string}>{
 const user=await currentUser();await chitchatCore.openProtectedStorage();const bundle=await chitchatCore.createDeviceIdentity(user.id);
 const {error}=await client().from("devices").upsert({id:bundle.device_id,user_id:user.id,device_label:"ChitChat device",platform:"react-native",identity_key_public:bundle.identity_key_public,signed_prekey_public:bundle.signed_prekey_public,signed_prekey_signature:bundle.signed_prekey_signature,key_version:bundle.key_version,fingerprint:bundle.fingerprint,last_seen_at:new Date().toISOString(),revoked_at:null},{onConflict:"id"});
 if(error)throw error;
 const keyPackage=await chitchatCore.generateKeyPackage(user.id+":"+bundle.device_id);
 const {error:packageError}=await client().from("mls_key_packages").upsert({device_id:bundle.device_id,user_id:user.id,key_package:keyPackage,key_version:1,expires_at:new Date(Date.now()+7*86400000).toISOString()},{onConflict:"device_id"});
 if(packageError)throw packageError;
 return {deviceId:bundle.device_id,bundle,keyPackage};
}

export async function createConversationMlsGroup(conversationId:string):Promise<string>{
 if(!conversationId)throw new Error("A conversation is required.");
 const user=await currentUser();const device=await publishMyMlsDevice();
 const groupId=await chitchatCore.createGroup(user.id+":"+device.deviceId);
 const epoch=await chitchatCore.currentEpoch(groupId);
 const {error}=await client().from("conversation_mls_groups").upsert({conversation_id:conversationId,mls_group_id:groupId,ciphersuite:"MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",protocol_version:1,epoch,status:"active",created_by:user.id},{onConflict:"conversation_id"});
 if(error)throw error;return groupId;
}

export async function getConversationMlsGroup(conversationId:string):Promise<{groupId:string;epoch:number}>{
 const {data,error}=await client().from("conversation_mls_groups").select("mls_group_id,epoch,status").eq("conversation_id",conversationId).maybeSingle();
 if(error)throw error;if(!data||data.status!=="active")throw new Error("This conversation has no active MLS group yet.");
 return {groupId:data.mls_group_id,epoch:Number(data.epoch)};
}

export async function sendMlsTextMessage(conversationId:string,text:string,options:{expiresAt?:string|null;concealed?:boolean}={}){
 return sendMlsContent(conversationId,createTextMessageContent(text,options.concealed??false),options.expiresAt??null);
}
export async function sendMlsContent(conversationId:string,content:MessageContent,expiresAt:string|null=null):Promise<EncryptedMessageRecord>{
 validateMessageContentShape(content);const user=await currentUser();const group=await getConversationMlsGroup(conversationId);
 const ciphertext=await chitchatCore.encryptContent(group.groupId,content);const epoch=await chitchatCore.currentEpoch(group.groupId);
 return sendEncryptedMessage(conversationId,{client_message_id:createUuid(),message_type:"text",ciphertext,nonce:"mls-rfc9420",crypto_header:{protocol:"mls",protocol_version:1,ciphersuite:"MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",group_id:group.groupId,epoch:epoch||group.epoch,sender_id:user.id,content_type:"application"},key_version:1,expires_at:expiresAt});
}
export async function decryptMlsMessage(record:EncryptedMessageRecord):Promise<MessageContent>{
 const header=record.crypto_header as Record<string,unknown>;
 if(header.protocol!=="mls"||header.content_type!=="application"||typeof header.group_id!=="string")throw new Error("Unsupported MLS message envelope.");
 const processed=await chitchatCore.processMessage(header.group_id,record.ciphertext);
 if(processed.kind!=="application"||!processed.content||typeof processed.content!=="object")throw new Error("No authenticated MLS application content was returned.");
 const content=processed.content as MessageContent;validateMessageContentShape(content);return content;
}
export async function loadDecryptedMlsHistory(conversationId:string,limit=100){
 const encrypted=await loadEncryptedMessages(conversationId,limit);
 const messages:Array<{record:EncryptedMessageRecord;content:MessageContent}>=[];
 const undecryptable:EncryptedMessageRecord[]=[];
 for(const record of encrypted){if(record.expires_at&&Date.parse(record.expires_at)<=Date.now())continue;try{messages.push({record,content:await decryptMlsMessage(record)});}catch{undecryptable.push(record);}}
 return {messages,undecryptable};
}
export async function searchDecryptedMlsHistory(conversationId:string,query:string,limit=100){
 const needle=query.trim().toLocaleLowerCase();if(!needle)return [];
 const history=await loadDecryptedMlsHistory(conversationId,limit);
 return history.messages.filter(({content})=>content.blocks.some(block=>block.type==="text"&&block.text.toLocaleLowerCase().includes(needle)));
}
function createUuid(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==="x"?r:(r&3)|8).toString(16);});}
