import { motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const palette = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0f766e', '#ca8a04', '#64748b'];

export function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div className="card p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      <div className="h-72">{children}</div>
    </motion.div>
  );
}

export function DistributionPie({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={88} paddingAngle={2}>
          {data.map((_, index) => (
            <Cell key={index} fill={palette[index % palette.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => [`${value} 分钟`, '用时']} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MinutesBar({ data, xKey = 'name', denseLabels = false }: { data: Array<Record<string, string | number>>; xKey?: string; denseLabels?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ bottom: denseLabels ? 34 : 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          height={denseLabels ? 58 : undefined}
          interval={0}
          tick={{ fontSize: 12 }}
          angle={denseLabels ? -28 : 0}
          textAnchor={denseLabels ? 'end' : 'middle'}
        />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip formatter={(value) => [`${value} 分钟`, '用时']} />
        <Bar dataKey="minutes" fill="#2563eb" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, dataKey = 'minutes', label = '分钟' }: { data: Array<Record<string, string | number>>; dataKey?: string; label?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip formatter={(value) => [`${value}`, label]} />
        <Line type="monotone" dataKey={dataKey} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ReviewTrendChart({ data }: { data: Array<Record<string, string | number | null>> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} domain={[1, 10]} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line type="monotone" connectNulls dataKey="score" name="复盘评分" stroke="#2563eb" strokeWidth={2.4} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
