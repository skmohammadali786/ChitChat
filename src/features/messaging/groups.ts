import { supabase } from "../../lib/supabase";

export type GroupMember = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
  member_role: "owner" | "admin" | "member";
  joined_at: string;
};

export type GroupInvitation = {
  invitation_id: string;
  invitee_id: string;
  invitee_username: string | null;
  invitee_display_name: string | null;
  status: "pending";
  created_at: string;
  expires_at: string;
};

export type MyGroupInvitation = {
  invitation_id: string;
  conversation_id: string;
  conversation_title: string | null;
  inviter_id: string;
  inviter_username: string | null;
  inviter_display_name: string | null;
  created_at: string;
  expires_at: string;
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function createGroupConversation(title: string, memberIds: string[]): Promise<string> {
  const cleanTitle = title.trim();
  const uniqueIds = [...new Set(memberIds)].filter(Boolean);
  if (cleanTitle.length < 1 || cleanTitle.length > 80) throw new Error("Group name must be 1 to 80 characters.");
  if (uniqueIds.length < 1 || uniqueIds.length > 99) throw new Error("Select between 1 and 99 other members.");
  const { data, error } = await client().rpc("create_group_conversation", {
    group_title: cleanTitle,
    member_ids: uniqueIds,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Supabase returned an invalid group ID.");
  return data;
}

export async function loadGroupMembers(conversationId: string): Promise<GroupMember[]> {
  const { data, error } = await client().rpc("list_group_members", {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as GroupMember[];
}

export async function addGroupMembers(conversationId: string, memberIds: string[]): Promise<number> {
  const { data, error } = await client().rpc("add_group_members", {
    target_conversation_id: conversationId,
    member_ids: [...new Set(memberIds)].filter(Boolean),
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function sendGroupInvitation(conversationId: string, userId: string): Promise<string> {
  if (!conversationId || !userId) throw new Error("A group and discoverable account are required.");
  const { data, error } = await client().rpc("create_group_invitation", {
    target_conversation_id: conversationId,
    target_user_id: userId,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Supabase returned an invalid invitation ID.");
  return data;
}

export async function loadGroupInvitations(conversationId: string): Promise<GroupInvitation[]> {
  const { data, error } = await client().rpc("list_group_invitations", {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as GroupInvitation[];
}

export async function loadMyGroupInvitations(): Promise<MyGroupInvitation[]> {
  const { data, error } = await client().rpc("list_my_group_invitations");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as MyGroupInvitation[];
}

export async function respondToGroupInvitation(
  invitationId: string,
  accept: boolean,
): Promise<"accepted" | "declined" | "expired"> {
  if (!invitationId) throw new Error("Choose a group invitation.");
  const { data, error } = await client().rpc("respond_group_invitation", {
    target_invitation_id: invitationId,
    accept_invitation: accept,
  });
  if (error) throw error;
  if (data !== "accepted" && data !== "declined" && data !== "expired") {
    throw new Error("Supabase returned an invalid invitation response.");
  }
  return data;
}

export async function revokeGroupInvitation(invitationId: string): Promise<void> {
  if (!invitationId) throw new Error("Choose an invitation to revoke.");
  const { error } = await client().rpc("revoke_group_invitation", {
    target_invitation_id: invitationId,
  });
  if (error) throw error;
}

export async function removeGroupMember(conversationId: string, userId: string): Promise<void> {
  const { error } = await client().rpc("remove_group_member", {
    target_conversation_id: conversationId,
    target_user_id: userId,
  });
  if (error) throw error;
}

export async function transferGroupOwnership(conversationId: string, newOwnerId: string): Promise<void> {
  const { error } = await client().rpc("transfer_group_owner", {
    target_conversation_id: conversationId,
    new_owner_id: newOwnerId,
  });
  if (error) throw error;
}

export async function renameGroupConversation(conversationId: string, title: string): Promise<void> {
  const cleanTitle = title.trim();
  if (cleanTitle.length < 1 || cleanTitle.length > 80) throw new Error("Group name must be 1 to 80 characters.");
  const { error } = await client().rpc("rename_group_conversation", {
    target_conversation_id: conversationId,
    new_title: cleanTitle,
  });
  if (error) throw error;
}

export async function setGroupMemberRole(
  conversationId: string,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  if (!conversationId || !userId) throw new Error("A group and member are required.");
  if (role !== "admin" && role !== "member") throw new Error("Unsupported group role.");
  const { error } = await client().rpc("set_group_member_role", {
    target_conversation_id: conversationId,
    target_user_id: userId,
    new_role: role,
  });
  if (error) throw error;
}
