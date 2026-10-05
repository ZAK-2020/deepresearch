import { Annotation, StateGraph, START, END } from "@langchain/langgraph";

export const stages = ["plan", "search", "analyze", "review", "write"];
export function researchStages({ documentIds = [], includeWeb = true, mode = 'live' } = {}) {
  return ['plan', ...(includeWeb ? ['search'] : []), ...(documentIds.length ? ['documents'] : []), 'analyze', 'review', 'write', ...(mode === 'live' ? ['verify'] : [])];
}
const State = Annotation.Root({
  question: Annotation(),
  depth: Annotation(),
  documentIds: Annotation(),
  includeWeb: Annotation(),
  plan: Annotation(),
  sources: Annotation(),
  analysis: Annotation(),
  review: Annotation(),
  report: Annotation(),
  reportBody: Annotation(),
  verification: Annotation(),
});

export function createResearchGraph(provider, onProgress = () => {}, selectedStages = stages) {
  const graph = new StateGraph(State);
  for (const stage of selectedStages) {
    graph.addNode(`${stage}_step`, async (state) => {
      await onProgress(stage, "running");
      const result = await provider[stage](state);
      await onProgress(stage, "complete", result);
      return result;
    });
  }
  graph.addEdge(START, `${selectedStages[0]}_step`);
  selectedStages.forEach((stage, index) =>
    graph.addEdge(
      `${stage}_step`,
      selectedStages[index + 1] ? `${selectedStages[index + 1]}_step` : END,
    ),
  );
  return graph.compile();
}
