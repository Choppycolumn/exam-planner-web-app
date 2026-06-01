import type {
  FinanceAllocationTarget,
  FinanceAssetType,
  FinanceCurrency,
  FinanceMarketExposure,
  FinanceRiskBucket,
  FinanceTargetActionStatus,
  FinanceTransactionStatus,
  FinanceTransactionType,
} from '../../types/finance';

export const financeCurrencyLabels: Record<FinanceCurrency, string> = {
  CNY: '人民币 CNY',
  USD: '美元 USD',
  USDT: 'USDT',
  USDC: 'USDC',
};

export const financeAssetTypeLabels: Record<FinanceAssetType, string> = {
  CASH_CNY: '人民币现金',
  CASH_USD: '美元现金',
  CNY_FIXED_INCOME_FUND: '人民币债券基金/低波动基金',
  USD_FIXED_INCOME_WEALTH: '美元固定收益类理财',
  QDII_EQUITY_CNY: '人民币份额海外股票指数基金',
  QDII_EQUITY_USD: '美元份额海外股票指数基金',
  REGIONAL_EQUITY_CNY: '区域市场股票基金',
  CRYPTO_STABLECOIN: 'USDT/USDC 现货',
  CRYPTO_STABLECOIN_EARN: '平台中的稳定币生息产品',
  GOLD_FUND: '黄金基金',
  OTHER: '其他资产',
};

export const financeTransactionTypeLabels: Record<FinanceTransactionType, string> = {
  OPENING_POSITION: '期初持仓',
  CASH_DEPOSIT: '现金转入',
  CASH_WITHDRAWAL: '现金转出',
  BUY: '买入/申购',
  SELL: '卖出/赎回',
  FX_CONVERSION: '换汇',
  DIVIDEND: '分红',
  INTEREST: '利息收益',
  REWARD: '平台奖励',
  FEE: '手续费',
  TRANSFER_IN: '转入',
  TRANSFER_OUT: '转出',
  ADJUSTMENT: '手动校正',
};

export const financeTransactionStatusLabels: Record<FinanceTransactionStatus, string> = {
  confirmed: '已确认',
  pending: '待确认',
  cancelled: '已取消',
};

export const financeRiskBucketLabels: Record<FinanceRiskBucket, string> = {
  low_volatility: '低波动资产',
  core_equity: '核心权益',
  satellite_equity: '卫星权益',
  platform_exploration: '平台探索',
  cash: '现金',
};

export const financeMarketExposureLabels: Record<FinanceMarketExposure, string> = {
  China: '人民币资产',
  US_SP500: '美国权益：标普 500',
  US_NASDAQ100: '美国权益：纳斯达克 100',
  Japan: '日本权益',
  Vietnam: '越南权益',
  France: '法国权益',
  Germany: '德国权益',
  HongKong: '港股权益',
  Gold: '黄金',
  USD_CashLike: '美元现金类',
  Stablecoin: '稳定币',
  Other: '其他区域',
};

export const financeActionStatusLabels: Record<FinanceTargetActionStatus, string> = {
  continue: '继续',
  pause_new: '暂停新增',
  exit: '准备退出',
  review: '待评估',
};

export const financeGroupLabels: Record<string, string> = {
  cny_cash_low_vol: '人民币现金与人民币低波动层',
  usd_low_vol: '美元低波动层',
  us_core_equity: '美国核心权益层',
  japan_view: '日本观点仓',
  vietnam_satellite: '越南卫星仓',
  exit_region: '计划退出区域仓',
  stablecoin_platform: '平台稳定币探索层',
  other: '其他资产',
};

export const financeGroupOptions = Object.entries(financeGroupLabels).map(([id, label]) => ({ id, label }));

export const financeAssetTypeOptions = Object.entries(financeAssetTypeLabels).map(([value, label]) => ({ value: value as FinanceAssetType, label }));
export const financeCurrencyOptions = Object.entries(financeCurrencyLabels).map(([value, label]) => ({ value: value as FinanceCurrency, label }));
export const financeRiskBucketOptions = Object.entries(financeRiskBucketLabels).map(([value, label]) => ({ value: value as FinanceRiskBucket, label }));
export const financeMarketExposureOptions = Object.entries(financeMarketExposureLabels).map(([value, label]) => ({ value: value as FinanceMarketExposure, label }));
export const financeTransactionTypeOptions = Object.entries(financeTransactionTypeLabels).map(([value, label]) => ({ value: value as FinanceTransactionType, label }));
export const financeTransactionStatusOptions = Object.entries(financeTransactionStatusLabels).map(([value, label]) => ({ value: value as FinanceTransactionStatus, label }));

export function createDefaultFinanceTargets(): FinanceAllocationTarget[] {
  return [
    {
      id: 'target-cny-cash-low-vol',
      name: financeGroupLabels.cny_cash_low_vol,
      assetGroupIds: ['cny_cash_low_vol'],
      targetPercent: 0,
      tolerancePercent: 5,
      continueInvesting: true,
      actionStatus: 'review',
      riskNote: '包含待投资现金池和人民币低波动基金；目标比例由你后续设置。',
      sortOrder: 1,
    },
    {
      id: 'target-usd-low-vol',
      name: financeGroupLabels.usd_low_vol,
      assetGroupIds: ['usd_low_vol'],
      targetPercent: 0,
      tolerancePercent: 5,
      continueInvesting: true,
      actionStatus: 'review',
      riskNote: '美元固定收益和类现金资产，不等同于保本。',
      sortOrder: 2,
    },
    {
      id: 'target-us-core',
      name: financeGroupLabels.us_core_equity,
      assetGroupIds: ['us_core_equity'],
      targetPercent: 0,
      tolerancePercent: 5,
      continueInvesting: true,
      actionStatus: 'review',
      riskNote: '标普和纳指相关资产，需关注权益波动和 QDII 净值滞后。',
      sortOrder: 3,
    },
    {
      id: 'target-japan',
      name: financeGroupLabels.japan_view,
      assetGroupIds: ['japan_view'],
      targetPercent: 0,
      tolerancePercent: 3,
      continueInvesting: true,
      actionStatus: 'review',
      riskNote: '观点仓位，适合单独控制比例。',
      sortOrder: 4,
    },
    {
      id: 'target-vietnam',
      name: financeGroupLabels.vietnam_satellite,
      assetGroupIds: ['vietnam_satellite'],
      targetPercent: 0,
      tolerancePercent: 3,
      continueInvesting: true,
      actionStatus: 'review',
      riskNote: '卫星仓位，需关注流动性、汇率和单一市场风险。',
      sortOrder: 5,
    },
    {
      id: 'target-exit-region',
      name: financeGroupLabels.exit_region,
      assetGroupIds: ['exit_region'],
      targetPercent: 0,
      tolerancePercent: 2,
      continueInvesting: false,
      actionStatus: 'exit',
      riskNote: '计划退出的区域仓，只提示偏离，不生成交易指令。',
      sortOrder: 6,
    },
    {
      id: 'target-stablecoin-platform',
      name: financeGroupLabels.stablecoin_platform,
      assetGroupIds: ['stablecoin_platform'],
      targetPercent: 0,
      tolerancePercent: 3,
      continueInvesting: false,
      actionStatus: 'pause_new',
      riskNote: '平台与稳定币风险单独归类，展示 APR 不计入真实收益。',
      sortOrder: 7,
    },
    {
      id: 'target-other',
      name: financeGroupLabels.other,
      assetGroupIds: ['other'],
      targetPercent: 0,
      tolerancePercent: 2,
      continueInvesting: false,
      actionStatus: 'review',
      riskNote: '黄金和其他资产。',
      sortOrder: 8,
    },
  ];
}
