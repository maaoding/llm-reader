import { runRerankEvaluation } from './rerank-eval-runner'
import { runDocumentStructureEvaluation } from './document-structure-eval-runner'
import { assessOfflineEvaluation, offlineBaseline, offlineFixtureSha256 } from './offline-eval-checks'

export async function runOfflineEvaluation() {
  const originalFetch = globalThis.fetch
  let networkAttempts = 0
  globalThis.fetch = async () => {
    networkAttempts++
    throw new Error('Offline evaluation must not call external services')
  }
  try {
    const retrieval = await runRerankEvaluation({ live: false })
    const structure = await runDocumentStructureEvaluation()
    const assessment = assessOfflineEvaluation(retrieval, structure)
    if (networkAttempts) {
      assessment.status = 'failed'
      assessment.failures.push({ group: 'offline', id: '*', check: 'unexpected-network-attempt' })
    }
    return { report: { schemaVersion: 1, baseline: offlineBaseline.id, fixtureSha256: offlineFixtureSha256(),
      mode: 'offline-retrieval', realServiceVerified: false, answerQualityAssessed: false,
      networkAttempts, ...assessment }, retrieval, structure }
  } finally {
    globalThis.fetch = originalFetch
  }
}
