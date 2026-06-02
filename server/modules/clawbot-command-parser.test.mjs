import { describe, expect, it } from 'vitest';
import { clawbotHelpText, parseClawbotCommand } from './clawbot-command-parser.mjs';

const today = '2026-06-01';

describe('parseClawbotCommand', () => {
  it('parses a create-task command with relative date, time and priority', () => {
    expect(parseClawbotCommand('待办 明天 15:30 高 背单词 50 个', { today })).toMatchObject({
      type: 'create_task',
      title: '背单词 50 个',
      dueDate: '2026-06-02',
      dueTime: '15:30',
      urgency: 'high',
    });
  });

  it('parses Chinese clock expressions', () => {
    expect(parseClawbotCommand('任务 后天 下午3点半 做数学题', { today })).toMatchObject({
      type: 'create_task',
      title: '做数学题',
      dueDate: '2026-06-03',
      dueTime: '15:30',
      urgency: 'medium',
    });
  });

  it('parses create-task commands with next-week weekdays', () => {
    expect(parseClawbotCommand('新增待办 下周一 p1 做周计划', { today })).toMatchObject({
      type: 'create_task',
      title: '做周计划',
      dueDate: '2026-06-08',
      urgency: 'high',
    });
  });

  it('defaults task date, time and priority when omitted', () => {
    expect(parseClawbotCommand('任务 整理错题', { today })).toMatchObject({
      type: 'create_task',
      title: '整理错题',
      dueDate: today,
      dueTime: '',
      urgency: 'medium',
    });
  });

  it('parses list, complete, delete, digest and help commands', () => {
    expect(parseClawbotCommand('今日待办', { today })).toMatchObject({ type: 'list_tasks', range: 'today' });
    expect(parseClawbotCommand('本周待办', { today })).toMatchObject({ type: 'list_tasks', range: 'week' });
    expect(parseClawbotCommand('完成A', { today })).toMatchObject({ type: 'complete_task', keyword: 'A' });
    expect(parseClawbotCommand('完成 背单词', { today })).toMatchObject({ type: 'complete_task', keyword: '背单词' });
    expect(parseClawbotCommand('删除待办 A', { today })).toMatchObject({ type: 'delete_task', keyword: 'A' });
    expect(parseClawbotCommand('每日简报', { today })).toMatchObject({ type: 'daily_digest' });
    expect(parseClawbotCommand('帮助', { today })).toEqual({ type: 'help', raw: '帮助' });
  });

  it('returns help for unsupported commands', () => {
    const parsed = parseClawbotCommand('随便聊聊', { today });
    expect(parsed.type).toBe('unknown');
    expect(parsed.help).toBe(clawbotHelpText);
  });
});
