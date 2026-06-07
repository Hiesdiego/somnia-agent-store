import type { ConsensusResult, MarketSnapshot, SignalWeights, TriggerEvent, AgentVote } from "./types.ts";
import { average, clamp, stdDev } from "./utils.ts";
import { defaultSignalWeights, normalizeWeights } from "./store.ts";

function stanceFromProbability(probability: number): "yes" | "no" | "watch" {
  if (probability >= 0.55) return "yes";
  if (probability <= 0.45) return "no";
  return "watch";
}

function baseProbability(snapshot: MarketSnapshot): number {
  return snapshot.signals.marketProbability ?? 0.5;
}

function buildSentimentVote(snapshot: MarketSnapshot): AgentVote {
  const probability = clamp(0.5 + snapshot.signals.sentimentScore * 0.28);
  const confidence = clamp(
    Math.abs(snapshot.signals.sentimentScore) * 0.65 + snapshot.signals.evidenceQualityScore * 0.35
  );
  return {
    agent: "sentiment",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: `Sentiment score ${snapshot.signals.sentimentScore.toFixed(2)} mapped to probability.`,
  };
}

function buildStatisticalVote(snapshot: MarketSnapshot, previous: MarketSnapshot | null): AgentVote {
  const market = baseProbability(snapshot);
  const previousMarket = previous?.signals.marketProbability ?? market;
  const move = market - previousMarket;
  const probability = clamp(market + move * 0.35);
  const confidence = clamp(Math.abs(move) * 4 + (snapshot.signals.volume ? 0.25 : 0.05));
  return {
    agent: "statistical",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: `Probability move ${move.toFixed(3)} over last snapshot.`,
  };
}

function buildOnchainVote(snapshot: MarketSnapshot): AgentVote {
  const probability = clamp(0.5 + snapshot.signals.whaleFlowScore * 0.3);
  const confidence = clamp(Math.abs(snapshot.signals.whaleFlowScore) * 0.8 + 0.1);
  return {
    agent: "onchain",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: `Whale-flow score ${snapshot.signals.whaleFlowScore.toFixed(2)} translated to directional pressure.`,
  };
}

function buildContrarianVote(snapshot: MarketSnapshot): AgentVote {
  const market = baseProbability(snapshot);
  const centered = 0.5 + (0.5 - market) * 0.55;
  const probability = clamp(centered);
  const confidence = clamp(Math.abs(market - 0.5) * 1.1);
  return {
    agent: "contrarian",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: `Contrarian adjustment against crowd probability ${market.toFixed(3)}.`,
  };
}

function buildNewsVote(snapshot: MarketSnapshot): AgentVote {
  const signal = snapshot.signals.sentimentScore * 0.55 + (snapshot.signals.marketProbability ?? 0.5) - 0.5;
  const probability = clamp(0.5 + signal * 0.35);
  const confidence = clamp(snapshot.signals.evidenceQualityScore * 0.6 + snapshot.signals.freshnessScore * 0.4);
  return {
    agent: "news",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: "External evidence freshness and sentiment alignment.",
  };
}

function buildRiskVote(snapshot: MarketSnapshot, triggerSeverity: number): AgentVote {
  const uncertainty =
    (1 - snapshot.signals.evidenceQualityScore) * 0.4 +
    (1 - snapshot.signals.freshnessScore) * 0.35 +
    triggerSeverity * 0.25;
  const probability = clamp(0.5 - (uncertainty - 0.5) * 0.2);
  const confidence = clamp(1 - uncertainty);
  return {
    agent: "risk",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: `Uncertainty ${uncertainty.toFixed(2)} from evidence quality/freshness/trigger stress.`,
  };
}

function buildSummaryVote(votes: AgentVote[]): AgentVote {
  const probabilities = votes.map((vote) => vote.probability);
  const confidence = average(votes.map((vote) => vote.confidence));
  const probability = clamp(average(probabilities));
  return {
    agent: "summary",
    probability,
    confidence,
    stance: stanceFromProbability(probability),
    rationale: "Average of specialist agents before weighted consensus.",
  };
}

function weightedProbability(votes: AgentVote[], weights: SignalWeights): number {
  const byAgent = new Map(votes.map((vote) => [vote.agent, vote]));
  const weightMap: Array<[keyof SignalWeights, AgentVote["agent"]]> = [
    ["sentiment", "sentiment"],
    ["statistical", "statistical"],
    ["onchain", "onchain"],
    ["contrarian", "contrarian"],
    ["news", "news"],
    ["risk", "risk"],
  ];

  let numerator = 0;
  let denominator = 0;
  for (const [weightKey, voteKey] of weightMap) {
    const vote = byAgent.get(voteKey);
    if (!vote) continue;
    const weight = Math.max(0, weights[weightKey]) * clamp(vote.confidence, 0.05, 1);
    numerator += vote.probability * weight;
    denominator += weight;
  }
  if (denominator <= 0) return 0.5;
  return clamp(numerator / denominator);
}

function liquidityScore(volume: number | null): number {
  if (volume === null || volume <= 0) return 0.35;
  const normalized = Math.log10(volume + 1) / 7;
  return clamp(normalized);
}

export function buildConsensus(input: {
  snapshot: MarketSnapshot;
  history: MarketSnapshot[];
  triggers: TriggerEvent[];
  weights?: SignalWeights | null;
}): ConsensusResult {
  const previous = input.history.find((item) => item.id !== input.snapshot.id) ?? null;
  const triggerSupport = clamp(
    input.triggers.length === 0
      ? 0.2
      : input.triggers.reduce((sum, trigger) => sum + trigger.severity, 0) / input.triggers.length
  );

  const votes: AgentVote[] = [
    buildSentimentVote(input.snapshot),
    buildStatisticalVote(input.snapshot, previous),
    buildOnchainVote(input.snapshot),
    buildContrarianVote(input.snapshot),
    buildNewsVote(input.snapshot),
    buildRiskVote(input.snapshot, triggerSupport),
  ];
  votes.push(buildSummaryVote(votes));

  const weights = normalizeWeights(input.weights ?? defaultSignalWeights());
  const probability = weightedProbability(votes, weights);
  const stance = stanceFromProbability(probability);
  const marketProbability = input.snapshot.signals.marketProbability;

  const edge =
    marketProbability === null
      ? null
      : stance === "yes"
        ? probability - marketProbability
        : stance === "no"
          ? marketProbability - probability
          : probability - marketProbability;

  const disagreement = stdDev(votes.filter((vote) => vote.agent !== "summary").map((vote) => vote.probability));
  const confidenceBreakdown = {
    evidenceQuality: clamp(input.snapshot.signals.evidenceQualityScore),
    freshness: clamp(input.snapshot.signals.freshnessScore),
    signalAgreement: clamp(1 - disagreement * 2),
    liquidity: liquidityScore(input.snapshot.signals.volume),
    triggerSupport,
  };

  const confidence = clamp(
    confidenceBreakdown.evidenceQuality * 0.28 +
      confidenceBreakdown.freshness * 0.18 +
      confidenceBreakdown.signalAgreement * 0.2 +
      confidenceBreakdown.liquidity * 0.14 +
      confidenceBreakdown.triggerSupport * 0.2
  );

  const summary = `Consensus ${stance.toUpperCase()} at ${(probability * 100).toFixed(1)}% with confidence ${(confidence * 100).toFixed(1)}% and disagreement ${(disagreement * 100).toFixed(1)}%.`;

  return {
    probability,
    stance,
    marketProbability,
    edge,
    confidence,
    confidenceBreakdown,
    disagreement,
    votes,
    summary,
  };
}

