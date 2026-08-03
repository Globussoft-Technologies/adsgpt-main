import axios from 'axios';
import getCookies from '@/utils/getCookies';

const API_ROOT = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;
const WORKSPACES_URL = `${API_ROOT}/workspaces`;
const AUTH_URL = `${API_ROOT}/workspace-auth`;

const authenticated = () => ({
  headers: { Authorization: `Bearer ${getCookies()}` },
});

export async function getWorkspaces() {
  const { data } = await axios.get(WORKSPACES_URL, authenticated());
  return data;
}

export async function inviteMember(email, features) {
  const { data } = await axios.post(
    `${WORKSPACES_URL}/invitations`,
    { email, features },
    authenticated()
  );
  return data;
}

export async function updateMemberFeatures(membershipId, features) {
  const { data } = await axios.patch(
    `${WORKSPACES_URL}/members/${membershipId}`,
    { features },
    authenticated()
  );
  return data;
}

export async function removeMember(membershipId) {
  const { data } = await axios.delete(`${WORKSPACES_URL}/members/${membershipId}`, authenticated());
  return data;
}

export async function revokeInvitation(invitationId) {
  const { data } = await axios.delete(
    `${WORKSPACES_URL}/invitations/${invitationId}`,
    authenticated()
  );
  return data;
}

export async function switchWorkspace(workspaceId) {
  const { data } = await axios.post(`${WORKSPACES_URL}/${workspaceId}/switch`, {}, authenticated());
  return data;
}

export async function getInvitation(token) {
  const { data } = await axios.get(`${AUTH_URL}/invitations/${encodeURIComponent(token)}`);
  return data;
}

export async function acceptInvitation(token, profile) {
  const { data } = await axios.post(
    `${AUTH_URL}/invitations/${encodeURIComponent(token)}/accept`,
    profile
  );
  return data;
}

export async function loginMember(email, password) {
  const { data } = await axios.post(`${AUTH_URL}/login`, { email, password });
  return data;
}
