import { supabase } from "../../lib/supabase";

export const MESSAGE_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "👎", "🔥", "🎉"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before reacting to messages.");
  return data.user.id;
}

export async function addMessageReaction(messageId: string, reaction: MessageReaction): Promise<void> {
  if (!MESSAGE_REACTIONS.includes(reaction)) throw new Error("Unsupported reaction.");
  const userId = await currentUserId();
  const { error } = await client().from("message_reactions").upsert(
    { message_id: messageId, user_id: userId, reaction },
    { onConflict: "message_id,user_id,reaction", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function removeMessageReaction(messageId: string, reaction: MessageReaction): Promise<void> {
  const userId = await currentUserId();
  const { error } = await client()
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("reaction", reaction);
  if (error) throw error;
}


export type MessageReactionSummary={message_id:string;reaction:MessageReaction;count:number;reacted_by_me:boolean};
export async function loadMessageReactionSummaries(messageIds:string[]):Promise<MessageReactionSummary[]>{
 const ids=[...new Set(messageIds.filter(Boolean))].slice(0,100);if(!ids.length)return [];
 const userId=await currentUserId();const {data,error}=await client().from("message_reactions").select("message_id,user_id,reaction").in("message_id",ids);if(error)throw error;
 const map=new Map<string,MessageReactionSummary>();for(const row of data??[]){if(!MESSAGE_REACTIONS.includes(row.reaction as MessageReaction))continue;const key=row.message_id+":"+row.reaction;const item=map.get(key)??{message_id:row.message_id,reaction:row.reaction as MessageReaction,count:0,reacted_by_me:false};item.count++;item.reacted_by_me ||= row.user_id===userId;map.set(key,item);}return [...map.values()];
}
export function subscribeToMessageReactions(conversationId:string,onChange:()=>void,onStatus?:(status:string)=>void):()=>void{
 if(!conversationId)throw new Error("A conversation is required.");let stopped=false;
 const channel=client().channel("conversation:"+conversationId,{config:{private:true}}).on("postgres_changes",{event:"*",schema:"public",table:"message_reactions"},()=>onChange());
 void client().realtime.setAuth().then(()=>{if(!stopped)channel.subscribe(status=>onStatus?.(status));}).catch(()=>onStatus?.("CHANNEL_ERROR"));
 return ()=>{stopped=true;void client().removeChannel(channel);};
}
