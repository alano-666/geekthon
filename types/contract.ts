// 全项目唯一事实源：数据形状的机器约束。
// 任何组件（mock 生成器 / MCP server / 桌宠前端 / 评分服务）产出或消费
// scores 数据，都必须符合此处类型。详细规则见 docs/CONTRACT.md。

/**
 * 桌宠状态（持续心情）。由"评分服务"经固定规则算出（见 docs/CONTRACT.md §3.3），
 * 前端只做 状态→动画 映射，不自行推导；大模型（Hermes）不参与此判定。
 */
export type PetState =
  // 正面 / 中性
  | "thriving" // 运动+阅读都达标且屏幕未超标：元气满满
  | "good" //     至少一项达标：一般满足
  | "resting" //  夜间(≥22:00)或无数据：睡觉
  // 负面（各对应一种需改进的行为）
  | "slacking" //  整体平庸、都没达标：蔫
  | "angry" //     运动量过低（硬线）：生气催动
  | "eyestrain" // 屏幕严重超标（硬线）：迷糊
  | "sick"; //     健康指标明显异常：生病

/**
 * 单项达标进度。value 为 0.0–1.0 归一化「健康度」：**越高越健康**，达标 = 1.0。
 * 极性由评分服务统一对齐：
 *  - 越多越好的指标（运动、阅读）：value = 进度 / 目标，截断到 1.0。
 *  - 越少越好的指标（屏幕时长）：value = 在预算内→接近 1.0，越超→越低。
 */
export interface MetricScore {
  /** 0.0–1.0 归一化健康度（越高越健康） */
  value: number;
  /** 是否达标。规则：value >= 1.0 即为 true */
  goalMet: boolean;
}

/** 某一天的评分快照。这是各开发阶段之间不变的"接缝"。 */
export interface Scores {
  /** 日期，格式 "YYYY-MM-DD" */
  date: string;
  /** 运动达标情况（越多越好） */
  exercise: MetricScore;
  /** 阅读达标情况（越多越好） */
  reading: MetricScore;
  /**
   * 屏幕使用时长（越少越好）。value 已由评分服务反转为「健康度」：
   * 在预算内→接近 1.0，越超→越低；goalMet = 当日屏幕未超预算。
   * 过渡期可选；评分服务接入屏幕数据源后应始终给出。
   */
  screen?: MetricScore;
  /** 桌宠状态，由规则算好直接给前端 */
  petState: PetState;
  /**
   * 今日已达成的成就 key 列表（累计，可选）。前端 diff 出"新增"项来播一次性庆祝（撒花）。
   * 建议 key：exercise_goal / steps_goal / workout_done / reading_2h …（开放扩展）。
   */
  achievements?: string[];
  /** 本条更新时间，ISO 8601 */
  updatedAt: string;
}
