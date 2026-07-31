import { Copy, KeyRound, Link2, LogOut, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { serverApi, type UserManagementResponse } from '../../api/client';

interface UserManagementSectionProps {
  visible: boolean;
  onMessage: (message: string) => void;
}

export function UserManagementSection({ visible, onMessage }: UserManagementSectionProps) {
  const [data, setData] = useState<UserManagementResponse | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [expiresInHours, setExpiresInHours] = useState('24');
  const [latestInvite, setLatestInvite] = useState<{ token: string; displayName: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setData(await serverApi.getUsers());
    } catch {
      setData(null);
    }
  };

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    void serverApi.getUsers()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const createInvite = async () => {
    if (!displayName.trim()) return onMessage('请先填写新用户显示名称');
    setBusy(true);
    try {
      const result = await serverApi.createUserInvite(displayName.trim(), Number(expiresInHours) || 24);
      setLatestInvite(result.invite);
      setDisplayName('');
      await refresh();
      onMessage('一次性邀请码已生成');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '邀请码生成失败');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!latestInvite) return;
    await navigator.clipboard.writeText(latestInvite.token);
    onMessage('邀请码已复制');
  };

  const toggleAccount = async (userId: number, name: string, active: boolean) => {
    const action = active ? '停用' : '启用';
    if (!confirm(`确定${action}“${name}”吗？${active ? '该用户现有登录会话会立即失效，数据仍会保留。' : ''}`)) return;
    setBusy(true);
    try {
      await serverApi.updateUser(userId, { displayName: name, status: active ? 'disabled' : 'active' });
      await refresh();
      onMessage(`用户已${action}`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : `${action}失败`);
    } finally {
      setBusy(false);
    }
  };

  const renameAccount = async (userId: number, currentName: string, status: 'active' | 'disabled') => {
    const nextName = prompt('新的显示名称', currentName)?.trim();
    if (!nextName || nextName === currentName) return;
    try {
      await serverApi.updateUser(userId, { displayName: nextName, status });
      await refresh();
      onMessage('显示名称已更新');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '名称更新失败');
    }
  };

  const resetPassword = async (userId: number, name: string) => {
    const password = prompt(`为“${name}”设置新密码（至少 8 位）`) || '';
    if (!password) return;
    if (password.length < 8) return onMessage('密码至少需要 8 位');
    try {
      await serverApi.resetUserPassword(userId, password);
      onMessage('密码已更新，该用户需要重新登录');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '密码更新失败');
    }
  };

  const revokeSessions = async (userId: number, name: string) => {
    if (!confirm(`确定让“${name}”退出所有设备吗？`)) return;
    try {
      await serverApi.revokeUserSessions(userId);
      onMessage('该用户的现有登录已全部撤销');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '撤销登录失败');
    }
  };

  if (!visible) return null;

  return (
    <section className="mt-5 card p-5" aria-labelledby="user-management-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="user-management-title" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={18} />用户与学习空间</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">每个用户拥有独立课程、计时、复盘和单词数据；学习对比仅共享汇总时长。</p>
        </div>
        <span className="app-status-pill">{data ? `${data.userCount} / ${data.maxUsers} 个席位` : '读取中'}</span>
      </div>

      <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {data?.users.map((account) => (
          <div key={account.userId} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-slate-900">{account.displayName}</strong>
                <span className={`app-status-pill ${account.status === 'active' ? 'app-status-success' : 'app-status-warning'}`}>{account.userRole === 'owner' ? '管理员' : account.status === 'active' ? '正常' : '已停用'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">创建于 {new Date(account.createdAt).toLocaleString()} · 最近登录 {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : '暂无'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void renameAccount(account.userId, account.displayName, account.status)}>改名</button>
              <button className="app-icon-button" type="button" title="重置密码" aria-label={`重置 ${account.displayName} 的密码`} disabled={busy} onClick={() => void resetPassword(account.userId, account.displayName)}><KeyRound size={16} /></button>
              <button className="app-icon-button" type="button" title="退出所有设备" aria-label={`让 ${account.displayName} 退出所有设备`} disabled={busy} onClick={() => void revokeSessions(account.userId, account.displayName)}><LogOut size={16} /></button>
              {account.userRole !== 'owner' ? <button className="app-icon-button" type="button" title={account.status === 'active' ? '停用用户' : '启用用户'} aria-label={`${account.status === 'active' ? '停用' : '启用'} ${account.displayName}`} disabled={busy} onClick={() => void toggleAccount(account.userId, account.displayName, account.status === 'active')}>{account.status === 'active' ? <UserRoundX size={16} /> : <UserRoundCheck size={16} />}</button> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">邀请新用户</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_auto]">
          <label><span className="label">显示名称</span><input className="field" value={displayName} maxLength={30} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 学习伙伴 3" /></label>
          <label><span className="label">有效时间</span><select className="field" value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)}><option value="1">1 小时</option><option value="24">24 小时</option><option value="72">3 天</option><option value="168">7 天</option></select></label>
          <div className="flex items-end"><button className="btn btn-primary" type="button" disabled={busy || !data?.canCreate} onClick={() => void createInvite()}><Link2 size={16} />生成邀请码</button></div>
        </div>
        {latestInvite ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><code className="min-w-0 flex-1 break-all">{latestInvite.token}</code><button className="btn btn-soft" type="button" onClick={() => void copyInvite()}><Copy size={15} />复制</button><span className="text-xs">有效至 {new Date(latestInvite.expiresAt).toLocaleString()}</span></div> : null}
      </div>

      {data?.invites.some((invite) => !invite.usedAt && !invite.revokedAt) ? <div className="mt-4 text-xs text-slate-500">当前有效邀请码：{data.invites.filter((invite) => !invite.usedAt && !invite.revokedAt).length} 个。邀请码只在创建时完整显示，可随时撤销并重新生成。</div> : null}
    </section>
  );
}
