// 全项目唯一事实源：数据形状的机器约束。
// 任何组件（mock 生成器 / MCP server / AIRI 前端 / 评分服务）产出或消费
// scores 数据，都必须符合此处类型。详细规则见 docs/CONTRACT.md。

/**
 * 桌宠状态。由"评分服务"经固定规则算出，前端只做 状态→动画 的映射，
 * 不自行推导；大模型（Hermes）不参与此判定。
 */
export type PetState = "thriving" | "good" | "slacking" | "resting";

/** 单项达标进度。value 为 0.0–1.0 归一化进度（达标=1.0，超出截断到 1.0）。 */
export interface MetricScore {
  /** 0.0–1.0 归一化达标进度 */
  value: number;
  /** 是否达标。规则：value >= 1.0 即为 true */
  goalMet: boolean;
}

/** 某一天的评分快照。这是三个开发阶段之间不变的"接缝"。 */
export interface Scores {
  /** 日期，格式 "YYYY-MM-DD" */
  date: string;
  /** 运动达标情况 */
  exercise: MetricScore;
  /** 阅读达标情况 */
  reading: MetricScore;
  /** 桌宠状态，由规则算好直接给前端 */
  petState: PetState;
  /** 本条更新时间，ISO 8601 */
  updatedAt: string;
}
