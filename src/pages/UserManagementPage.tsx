import { useCallback, useEffect, useState, type FormEvent } from "react";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Spinner from "../components/Spinner";
import {
  createManagedUser,
  listManagedUsers,
  RagApiError,
  updateManagedUser,
  type ManagedUser,
  type PermissionKey,
  type UserRole,
} from "../lib/ragApi";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "policy_manager", label: "Policy manager" },
  { value: "analyst", label: "Analyst" },
  { value: "viewer", label: "Viewer" },
];

const PERMISSIONS: { value: PermissionKey; label: string; description: string }[] = [
  { value: "dashboard:view", label: "Dashboard", description: "View workspace policies and overview." },
  { value: "policy:manage", label: "Create and manage policies", description: "Create or update policy records." },
  { value: "prompt:use", label: "Policy setting", description: "Use the policy prompt workspace." },
  { value: "optimize:run", label: "Model optimization", description: "Run policy optimization analysis." },
  { value: "data:view", label: "View Data Lake", description: "Browse ingested evidence and sources." },
  { value: "data:manage", label: "Manage Data Lake", description: "Add, edit, and remove evidence sources." },
  { value: "monitoring:view", label: "Policy monitoring", description: "View lifecycle stages and evidence briefings." },
  { value: "users:manage", label: "Manage users", description: "Create users and change roles and permissions." },
];

const ROLE_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  admin: PERMISSIONS.map((permission) => permission.value),
  policy_manager: ["dashboard:view", "policy:manage", "prompt:use", "optimize:run", "data:view", "data:manage", "monitoring:view"],
  analyst: ["dashboard:view", "prompt:use", "optimize:run", "data:view", "monitoring:view"],
  viewer: ["dashboard:view", "monitoring:view"],
};

function message(error: unknown): string {
  if (error instanceof RagApiError || error instanceof Error) return error.message;
  return "Request failed.";
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("analyst");
  const [permissions, setPermissions] = useState<PermissionKey[]>(ROLE_DEFAULTS.analyst);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("analyst");
  const [newPermissions, setNewPermissions] = useState<PermissionKey[]>(ROLE_DEFAULTS.analyst);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedUser = users.find((user) => user.id === selectedId) ?? null;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listManagedUsers();
      setUsers(data);
      setSelectedId((previous) => data.some((user) => user.id === previous) ? previous : data[0]?.id ?? null);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (!selectedUser) return;
    setRole(selectedUser.role);
    setPermissions(selectedUser.permissions);
  }, [selectedId, selectedUser]);

  function setToggle<T extends string>(values: T[], value: T, checked: boolean, update: (next: T[]) => void) {
    update(checked ? [...new Set([...values, value])] : values.filter((item) => item !== value));
  }

  async function saveUser() {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateManagedUser(selectedUser.id, { role, permissions });
      setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
      setNotice("User role and permissions saved.");
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: ManagedUser) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateManagedUser(user.id, { is_active: !user.is_active });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(updated.is_active ? "User account enabled." : "User account disabled.");
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createManagedUser({ email: newEmail, name: newName, password: newPassword, role: newRole, permissions: newPermissions });
      setUsers((current) => [...current, created].sort((a, b) => a.email.localeCompare(b.email)));
      setSelectedId(created.id);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNotice("User account created.");
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="min-h-full py-10">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-secondary-500 font-sans">Workspace administration</p>
            <h1 className="text-3xl font-extrabold text-secondary-900 font-sans">Users & permissions</h1>
            <p className="mt-1 text-secondary-500 font-sans">Create workspace accounts, assign a role, then grant access to specific pages and actions.</p>
          </div>

          {error && <Alert variant="error" title="Could not complete request" onClose={() => setError(null)} className="mb-5">{error}</Alert>}
          {notice && <Alert variant="success" onClose={() => setNotice(null)} className="mb-5">{notice}</Alert>}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="mb-5 flex items-center justify-between">
                <div><h2 className="text-base font-bold text-secondary-900 font-sans">Workspace users</h2><p className="text-xs text-secondary-500 font-sans">{users.length} account{users.length === 1 ? "" : "s"}</p></div>
                <Button size="sm" variant="ghost" onClick={() => void loadUsers()}>Refresh</Button>
              </div>
              {loading ? <div className="flex justify-center py-8"><Spinner label="Loading users…" /></div> : users.length === 0 ? <p className="py-8 text-center text-sm text-secondary-500 font-sans">No users in this workspace.</p> : (
                <div className="flex flex-col gap-2">
                  {users.map((user) => (
                    <button key={user.id} type="button" onClick={() => setSelectedId(user.id)} className={`rounded-xl border p-3 text-left ${selectedId === user.id ? "border-primary-300 bg-primary-50" : "border-secondary-100 hover:bg-secondary-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-secondary-800 font-sans">{user.name}</span><span className="block truncate text-xs text-secondary-500 font-sans">{user.email}</span></span>
                        <span className="flex shrink-0 flex-col items-end gap-1"><Badge variant={user.is_active ? "success" : "error"}>{user.is_active ? "Active" : "Disabled"}</Badge><span className="text-xs text-secondary-500">{ROLE_OPTIONS.find((option) => option.value === user.role)?.label}</span></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-base font-bold text-secondary-900 font-sans">Add a user</h2>
              <form onSubmit={addUser} className="mt-4 flex flex-col gap-3">
                <input required type="text" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Full name" className="rounded-lg border border-secondary-200 px-3 py-2 text-sm" />
                <input required type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="Email address" className="rounded-lg border border-secondary-200 px-3 py-2 text-sm" />
                <input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Temporary password (at least 8 characters)" className="rounded-lg border border-secondary-200 px-3 py-2 text-sm" />
                <label className="flex flex-col gap-1 text-xs font-semibold text-secondary-500">Role<select value={newRole} onChange={(event) => { const value = event.target.value as UserRole; setNewRole(value); setNewPermissions(ROLE_DEFAULTS[value]); }} className="rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800">{ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <PermissionChecklist values={newPermissions} onChange={(value, checked) => setToggle(newPermissions, value, checked, setNewPermissions)} />
                <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create user"}</Button>
              </form>
            </Card>
          </div>

          {selectedUser && (
            <Card className="mt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-base font-bold text-secondary-900 font-sans">Access for {selectedUser.name}</h2><p className="text-xs text-secondary-500 font-sans">{selectedUser.email}</p></div>
                <Button size="sm" variant={selectedUser.is_active ? "secondary" : "primary"} disabled={saving} onClick={() => void toggleActive(selectedUser)}>{selectedUser.is_active ? "Disable account" : "Enable account"}</Button>
              </div>
              <label className="mt-4 flex max-w-sm flex-col gap-1 text-xs font-semibold text-secondary-500">Role<select value={role} onChange={(event) => { const value = event.target.value as UserRole; setRole(value); setPermissions(ROLE_DEFAULTS[value]); }} className="rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800">{ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <PermissionChecklist values={permissions} onChange={(value, checked) => setToggle(permissions, value, checked, setPermissions)} />
              <div className="mt-5 flex justify-end"><Button disabled={saving} onClick={() => void saveUser()}>{saving ? "Saving…" : "Save access"}</Button></div>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function PermissionChecklist({ values, onChange }: { values: PermissionKey[]; onChange: (value: PermissionKey, checked: boolean) => void }) {
  return (
    <fieldset className="mt-2">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary-500">Page and action permissions</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PERMISSIONS.map((permission) => (
          <label key={permission.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-secondary-100 p-2.5">
            <input type="checkbox" checked={values.includes(permission.value)} onChange={(event) => onChange(permission.value, event.target.checked)} className="mt-0.5 accent-primary-600" />
            <span><span className="block text-xs font-semibold text-secondary-800">{permission.label}</span><span className="mt-0.5 block text-[11px] text-secondary-500">{permission.description}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
