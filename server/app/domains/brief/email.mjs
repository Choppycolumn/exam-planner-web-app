export function installBriefEmailDomain(runtime, exposeRuntime) {
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function encodeMailHeader(value) {
        return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
    }
    function dailyBriefStudyPushHtml(learning = {}) {
        const tasks = Array.isArray(learning.todayTasks) ? learning.todayTasks : [];
        const themes = Array.isArray(learning.topErrorThemes) ? learning.topErrorThemes : [];
        const yesterdayMinutes = Number(learning.yesterdayMinutes || 0);
        const items = [];
        if (learning.activeGoal?.daysLeft != null) {
            items.push(`距离「${learning.activeGoal.name}」还有 ${learning.activeGoal.daysLeft} 天，今天至少完成一个能推进长期目标的硬任务。`);
        }
        if (learning.yesterdayReview?.tomorrowPlan) {
            items.push(`优先执行昨日写给今天的计划：${runtime.compactText(learning.yesterdayReview.tomorrowPlan, 90)}`);
        }
        if (tasks.length) {
            items.push(`今天有 ${tasks.length} 个待推进短期目标，先从最紧急的一项开始，不要等到晚上再补。`);
        }
        if (yesterdayMinutes < 180) {
            items.push('昨日学习时长偏少，今天先用一个 30 分钟启动块把状态拉起来。');
        }
        else {
            items.push(`昨日已学习 ${runtime.minutesText(yesterdayMinutes)}，今天的重点是延续节奏，而不是重新找感觉。`);
        }
        if (themes[0]) {
            items.push(`近期高频问题是「${themes[0].label}」，今天学习时专门留意这个坑，结束后在复盘里写清楚是否改善。`);
        }
        return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    function dailyBriefHtml(payload) {
        const weather = payload.weather || {};
        const markets = payload.markets || [];
        const indexPurchaseAssessment = payload.indexPurchaseAssessment || {};
        const customWeeklyPush = payload.customWeeklyPush || {};
        const englishWritingPlan = payload.englishWritingPlan || {};
        const assessmentRows = (indexPurchaseAssessment.items || []).map((item) => item.ok
            ? `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.signal)}</td><td>${escapeHtml(item.pe)}（5 年 ${escapeHtml(item.pePercentile5)}% / 10 年 ${escapeHtml(item.pePercentile10)}%）</td><td>${escapeHtml(item.sma50Margin)}% / ${escapeHtml(item.sma200Margin)}%</td><td>${escapeHtml(item.intensity)}</td></tr>`
            : `<tr><td>${escapeHtml(item.name)}</td><td colspan="4">评估失败：${escapeHtml(item.error || '')}</td></tr>`).join('');
        const learning = payload.learning || {};
        const taskItems = (learning.todayTasks || []).map((task) => `<li>${escapeHtml(task.title)} <span style="color:#64748b">(${escapeHtml(task.urgency)} / ${escapeHtml(task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate)})</span></li>`).join('');
        const marketRows = markets.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.symbol)}</td><td>${item.ok ? escapeHtml(item.price) : '失败'}</td><td style="color:${Number(item.changePercent || 0) >= 0 ? '#16a34a' : '#dc2626'}">${item.ok ? `${escapeHtml(item.changePercent)}%` : escapeHtml(item.error || '')}</td></tr>`).join('');
        const studyPush = dailyBriefStudyPushHtml(learning);
        return `<!doctype html>
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
      <h1>${escapeHtml(payload.title)}</h1>
      <p style="color:#64748b">生成时间：${escapeHtml(new Date(payload.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>
      <h2>天气</h2>
      <p>${escapeHtml(weather.cityName || '')}：${weather.ok ? `${escapeHtml(weather.condition)}，${escapeHtml(weather.temperature)}℃，${escapeHtml(weather.minTemperature)}-${escapeHtml(weather.maxTemperature)}℃，降水概率 ${escapeHtml(weather.precipitationProbability)}%` : `获取失败：${escapeHtml(weather.error || '')}`}</p>
      <h2>学习提醒</h2>
      <p>昨日学习：${Math.round(Number(learning.yesterdayMinutes || 0) / 60 * 10) / 10} 小时；近 7 天累计：${Math.round(Number(learning.last7Minutes || 0) / 60 * 10) / 10} 小时。</p>
      ${englishWritingPlan.enabled && englishWritingPlan.includeInBrief ? `<h2>英语写作计划</h2><p><strong>当前阶段：</strong>${escapeHtml(englishWritingPlan.currentStage?.name || '未设置')} ${englishWritingPlan.currentStage?.weeks ? `（${escapeHtml(englishWritingPlan.currentStage.weeks)}）` : ''}</p><p><strong>阶段重点：</strong>${escapeHtml(englishWritingPlan.currentStage?.focus || '')}</p><p><strong>${escapeHtml(englishWritingPlan.weekdayLabel || '今日')}任务：</strong>${escapeHtml(englishWritingPlan.todayTask || '今天未设置固定写作任务')}；建议用时 ${escapeHtml(englishWritingPlan.dailyMinutes || '20-25 分钟')}。</p>` : ''}
      ${customWeeklyPush.hasContent ? `<h2>${escapeHtml(customWeeklyPush.weekdayLabel || '今日')}自定义推送</h2><p style="white-space:pre-wrap">${escapeHtml(customWeeklyPush.content)}</p>` : ''}
      <h2>今日学习督促</h2>
      ${studyPush}
      ${learning.yesterdayReview ? `<p><strong>昨日问题：</strong>${escapeHtml(learning.yesterdayReview.problems || '未填写')}</p>` : '<p>昨日尚未填写复盘。</p>'}
      ${taskItems ? `<p><strong>今日待推进：</strong></p><ul>${taskItems}</ul>` : '<p>今日暂无到期短期目标。</p>'}
      <h2>指数与资产</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>名称</th><th>代码</th><th>最新</th><th>涨跌</th></tr></thead><tbody>${marketRows || '<tr><td colspan="4">暂无配置</td></tr>'}</tbody></table>
      <h2>纳指 100 / 标普 500 定投评估</h2>
      <p>${escapeHtml(indexPurchaseAssessment.methodology || '')}</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border-color:#e2e8f0"><thead><tr><th>指数</th><th>结论</th><th>PE</th><th>距 50/200 日均线</th><th>定投强度参考</th></tr></thead><tbody>${assessmentRows || '<tr><td colspan="5">暂无评估数据</td></tr>'}</tbody></table>
      <p style="color:#64748b">${escapeHtml(indexPurchaseAssessment.disclaimer || '')}</p>
    </body></html>`;
    }
    function smtpReadResponse(socket, state) {
        return new Promise((resolve, reject) => {
            const onData = (chunk) => {
                state.buffer += chunk.toString('utf8');
                const lines = state.buffer.split(/\r?\n/);
                const lastComplete = state.buffer.endsWith('\n') ? lines : lines.slice(0, -1);
                const doneLine = lastComplete.find((line) => /^\d{3} /.test(line));
                if (!doneLine)
                    return;
                socket.off('data', onData);
                socket.off('error', onError);
                state.buffer = '';
                const code = Number(doneLine.slice(0, 3));
                if (code >= 400)
                    reject(new Error(`SMTP ${doneLine}`));
                else
                    resolve({ code, text: lastComplete.join('\n') });
            };
            const onError = (error) => {
                socket.off('data', onData);
                reject(error);
            };
            socket.on('data', onData);
            socket.once('error', onError);
        });
    }
    async function smtpSendLine(socket, state, line) {
        socket.write(`${line}\r\n`);
        return smtpReadResponse(socket, state);
    }
    async function sendDailyBriefEmail(payload, emailSettings) {
        const recipients = String(emailSettings.to || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
        if (!emailSettings.host || !emailSettings.from || !recipients.length) {
            throw new Error('SMTP host/from/to 未完整配置');
        }
        let socket = await new Promise((resolve, reject) => {
            const connector = emailSettings.secureMode === 'ssl'
                ? runtime.tlsConnect({ host: emailSettings.host, port: emailSettings.port, servername: emailSettings.host }, () => resolve(connector))
                : runtime.netConnect({ host: emailSettings.host, port: emailSettings.port }, () => resolve(connector));
            connector.setTimeout(15000, () => reject(new Error('SMTP connection timeout')));
            connector.once('error', reject);
        });
        const state = { buffer: '' };
        try {
            await smtpReadResponse(socket, state);
            await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
            if (emailSettings.secureMode === 'starttls') {
                await smtpSendLine(socket, state, 'STARTTLS');
                socket = runtime.tlsConnect({ socket, servername: emailSettings.host });
                await new Promise((resolve, reject) => {
                    socket.once('secureConnect', resolve);
                    socket.once('error', reject);
                });
                state.buffer = '';
                await smtpSendLine(socket, state, `EHLO ${emailSettings.host}`);
            }
            if (emailSettings.username) {
                await smtpSendLine(socket, state, 'AUTH LOGIN');
                await smtpSendLine(socket, state, Buffer.from(emailSettings.username, 'utf8').toString('base64'));
                await smtpSendLine(socket, state, Buffer.from(emailSettings.password || '', 'utf8').toString('base64'));
            }
            await smtpSendLine(socket, state, `MAIL FROM:<${emailSettings.from}>`);
            for (const recipient of recipients) {
                await smtpSendLine(socket, state, `RCPT TO:<${recipient}>`);
            }
            await smtpSendLine(socket, state, 'DATA');
            const subject = `${emailSettings.subjectPrefix || 'Exam Planner 今日简报'} - ${payload.date}`;
            const html = dailyBriefHtml(payload);
            const message = [
                `From: ${emailSettings.from}`,
                `To: ${recipients.join(', ')}`,
                `Subject: ${encodeMailHeader(subject)}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                html,
            ].join('\r\n').replace(/\r\n\./g, '\r\n..');
            socket.write(`${message}\r\n.\r\n`);
            await smtpReadResponse(socket, state);
            await smtpSendLine(socket, state, 'QUIT').catch(() => undefined);
        }
        finally {
            socket.end();
        }
    }

    exposeRuntime({
        escapeHtml: () => escapeHtml,
        encodeMailHeader: () => encodeMailHeader,
        dailyBriefStudyPushHtml: () => dailyBriefStudyPushHtml,
        dailyBriefHtml: () => dailyBriefHtml,
        smtpReadResponse: () => smtpReadResponse,
        smtpSendLine: () => smtpSendLine,
        sendDailyBriefEmail: () => sendDailyBriefEmail,
    });
}
