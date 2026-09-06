import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mock functions that are available during vi.mock hoisting
const { mockCreateClient, mockFrom, mockRpc, mockListEncodedFiles } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  const mockListEncodedFiles = vi.fn()
  const mockCreateClient = vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  }))
  return { mockCreateClient, mockFrom, mockRpc, mockListEncodedFiles }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/axiom/rulespec/repo-listing', () => ({
  listEncodedFiles: (...args: unknown[]) => mockListEncodedFiles(...args),
}))

// Now import the functions (they'll use the mocked supabase client)
import {
  getEncodingRuns,
  getAgentTranscripts,
  getTranscriptsBySession,
  getSDKSessions,
  getSDKSessionEvents,
  getSDKSessionMeta,
  getRuleEncoding,
  searchRules,
  getRuleReferences,
  getAxiomStats,
} from './supabase'
import { _resetRawFetchCache } from '@/lib/axiom/rulespec/raw-cache'

describe('supabase lib', () => {
  beforeEach(() => {
    mockFrom.mockClear()
    mockRpc.mockClear()
    mockListEncodedFiles.mockReset()
    mockListEncodedFiles.mockResolvedValue([])
    _resetRawFetchCache()
  })

  describe('schema clients', () => {
    it('creates dedicated corpus, encodings, and telemetry clients', () => {
      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ db: { schema: 'corpus' } })
      )
      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ db: { schema: 'encodings' } })
      )
      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ db: { schema: 'telemetry' } })
      )
      expect(mockCreateClient).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { db: { schema: 'app' } }
      )
    })
  })

  describe('getEncodingRuns', () => {
    it('returns encoding runs from rpc', async () => {
      const mockData = [{ id: '1', citation: '26 USC 1' }]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const result = await getEncodingRuns(10, 0)
      expect(result).toEqual(mockData)
      expect(mockRpc).toHaveBeenCalledWith('get_encoding_runs', {
        limit_count: 10,
        offset_count: 0,
      })
    })

    it('returns empty array on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: { message: 'test error' } })

      const result = await getEncodingRuns()
      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('returns empty array when data is null', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      const result = await getEncodingRuns()
      expect(result).toEqual([])
    })

    it('uses default parameters', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null })
      await getEncodingRuns()
      expect(mockRpc).toHaveBeenCalledWith('get_encoding_runs', {
        limit_count: 100,
        offset_count: 0,
      })
    })
  })

  describe('getAgentTranscripts', () => {
    it('returns transcripts', async () => {
      const mockData = [{ id: 1, subagent_type: 'encoder' }]
      const rangeFn = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const orderFn = vi.fn().mockReturnValue({ range: rangeFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getAgentTranscripts(50, 10)
      expect(result).toEqual(mockData)
      expect(mockFrom).toHaveBeenCalledWith('agent_transcripts')
      expect(selectFn).toHaveBeenCalledWith('*')
      expect(orderFn).toHaveBeenCalledWith('created_at', { ascending: false })
      expect(rangeFn).toHaveBeenCalledWith(10, 59)
    })

    it('returns empty array on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const rangeFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } })
      const orderFn = vi.fn().mockReturnValue({ range: rangeFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getAgentTranscripts()
      expect(result).toEqual([])
      consoleSpy.mockRestore()
    })

    it('returns empty when data is null without error', async () => {
      const rangeFn = vi.fn().mockResolvedValue({ data: null, error: null })
      const orderFn = vi.fn().mockReturnValue({ range: rangeFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getAgentTranscripts()
      expect(result).toEqual([])
    })
  })

  describe('getTranscriptsBySession', () => {
    it('returns transcripts for a session', async () => {
      const mockData = [{ id: 1, session_id: 'sess-1' }]
      const orderFn = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getTranscriptsBySession('sess-1')
      expect(result).toEqual(mockData)
      expect(mockFrom).toHaveBeenCalledWith('agent_transcripts')
      expect(eqFn).toHaveBeenCalledWith('session_id', 'sess-1')
    })

    it('returns empty array on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const orderFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getTranscriptsBySession('sess-1')
      expect(result).toEqual([])
      consoleSpy.mockRestore()
    })

    it('returns empty when data is null without error', async () => {
      const orderFn = vi.fn().mockResolvedValue({ data: null, error: null })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getTranscriptsBySession('sess-1')
      expect(result).toEqual([])
    })
  })

  describe('getSDKSessions', () => {
    it('returns SDK sessions', async () => {
      const mockData = [{ id: 'sdk-1' }]
      const limitFn = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessions(10)
      expect(result).toEqual([{ id: 'sdk-1', encoder_version: null }])
      expect(mockFrom).toHaveBeenCalledWith('sdk_sessions')
      expect(limitFn).toHaveBeenCalledWith(10)
    })

    it('returns empty array on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const limitFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessions()
      expect(result).toEqual([])
      consoleSpy.mockRestore()
    })

    it('uses default limit', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: [], error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      await getSDKSessions()
      expect(limitFn).toHaveBeenCalledWith(50)
    })

    it('returns empty when data is null without error', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: null, error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const selectFn = vi.fn().mockReturnValue({ order: orderFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessions()
      expect(result).toEqual([])
    })
  })

  describe('getSDKSessionEvents', () => {
    it('returns events for a session', async () => {
      const mockData = [{ id: 'evt-1' }]
      const limitFn = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionEvents('sdk-1', 50)
      expect(result).toEqual(mockData)
      expect(mockFrom).toHaveBeenCalledWith('sdk_session_events')
      expect(eqFn).toHaveBeenCalledWith('session_id', 'sdk-1')
    })

    it('returns empty array on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const limitFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionEvents('sdk-1')
      expect(result).toEqual([])
      consoleSpy.mockRestore()
    })

    it('uses default limit', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: [], error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      await getSDKSessionEvents('sdk-1')
      expect(limitFn).toHaveBeenCalledWith(2000)
    })

    it('returns empty when data is null without error', async () => {
      const limitFn = vi.fn().mockResolvedValue({ data: null, error: null })
      const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
      const eqFn = vi.fn().mockReturnValue({ order: orderFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionEvents('sdk-1')
      expect(result).toEqual([])
    })
  })

  describe('getSDKSessionMeta', () => {
    it('returns empty object for empty sessionIds', async () => {
      const result = await getSDKSessionMeta([])
      expect(result).toEqual({})
    })

    it('returns meta with title from agent_start events', async () => {
      const startEvents = [
        { session_id: 'sdk-1', content: 'Encode 26 USC 32 subsection a' },
      ]
      const lastEvents = [
        { session_id: 'sdk-1', timestamp: '2025-01-01T10:30:00Z' },
      ]

      // First call: startEvents, second call: lastEvents
      let callCount = 0
      const inFn = vi.fn()
      const eqFn = vi.fn()
      const orderFn = vi.fn()
      const selectFn = vi.fn()

      orderFn.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return { data: startEvents, error: null }
        }
        return { data: lastEvents, error: null }
      })

      eqFn.mockReturnValue({ order: orderFn })
      inFn.mockReturnValue({ eq: eqFn, order: orderFn })
      selectFn.mockReturnValue({ in: inFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionMeta(['sdk-1'])
      expect(result['sdk-1']).toBeDefined()
      expect(result['sdk-1'].title).toBe('26 USC 32')
      expect(result['sdk-1'].lastEventAt).toBe('2025-01-01T10:30:00Z')
    })

    it('returns content prefix as title when no match pattern', async () => {
      const startEvents = [
        { session_id: 'sdk-1', content: 'Some arbitrary task description' },
      ]

      let callCount = 0
      const inFn = vi.fn()
      const eqFn = vi.fn()
      const orderFn = vi.fn()
      const selectFn = vi.fn()

      orderFn.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return { data: startEvents, error: null }
        }
        return { data: [], error: null }
      })

      eqFn.mockReturnValue({ order: orderFn })
      inFn.mockReturnValue({ eq: eqFn, order: orderFn })
      selectFn.mockReturnValue({ in: inFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionMeta(['sdk-1'])
      expect(result['sdk-1'].title).toBe('Some arbitrary task description')
    })

    it('handles null content in start events', async () => {
      const startEvents = [
        { session_id: 'sdk-1', content: null },
      ]

      let callCount = 0
      const inFn = vi.fn()
      const eqFn = vi.fn()
      const orderFn = vi.fn()
      const selectFn = vi.fn()

      orderFn.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return { data: startEvents, error: null }
        }
        return { data: [{ session_id: 'sdk-1', timestamp: '2025-01-01T10:30:00Z' }], error: null }
      })

      eqFn.mockReturnValue({ order: orderFn })
      inFn.mockReturnValue({ eq: eqFn, order: orderFn })
      selectFn.mockReturnValue({ in: inFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionMeta(['sdk-1'])
      // Session has lastEventAt but empty title since content was null
      expect(result['sdk-1']).toEqual({ title: '', lastEventAt: '2025-01-01T10:30:00Z' })
    })

    it('handles null data from queries', async () => {
      const inFn = vi.fn()
      const eqFn = vi.fn()
      const orderFn = vi.fn()
      const selectFn = vi.fn()

      orderFn.mockResolvedValue({ data: null, error: null })
      eqFn.mockReturnValue({ order: orderFn })
      inFn.mockReturnValue({ eq: eqFn, order: orderFn })
      selectFn.mockReturnValue({ in: inFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionMeta(['sdk-1'])
      expect(result).toEqual({})
    })

    it('only takes first start event per session', async () => {
      const startEvents = [
        { session_id: 'sdk-1', content: 'Encode 26 USC 1' },
        { session_id: 'sdk-1', content: 'Encode 26 USC 2' },
      ]

      let callCount = 0
      const inFn = vi.fn()
      const eqFn = vi.fn()
      const orderFn = vi.fn()
      const selectFn = vi.fn()

      orderFn.mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          return { data: startEvents, error: null }
        }
        return { data: [], error: null }
      })

      eqFn.mockReturnValue({ order: orderFn })
      inFn.mockReturnValue({ eq: eqFn, order: orderFn })
      selectFn.mockReturnValue({ in: inFn })
      mockFrom.mockReturnValue({ select: selectFn })

      const result = await getSDKSessionMeta(['sdk-1'])
      // Should only take the first
      expect(result['sdk-1'].title).toBe('26 USC 1')
    })
  })

  // Helper to build a mock for encoding_runs that uses .in() instead of .eq()
  function mockEncodingRunsChain(result: { data: any; error: any }) {
    return {
      select: () => ({
        in: () => ({
          order: () => Promise.resolve(result),
        }),
      }),
    }
  }

  describe('getRuleEncoding', () => {
    it('returns encoding data when rule has citation_path and encoding exists', async () => {
      // getRuleEncoding calls supabaseCorpus.from('current_provisions') then supabaseEncodings.from('encoding_runs')
      // Both clients use the same mockFrom since createClient is mocked once
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/1', jurisdiction: 'us', rulespec_path: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        // encoding_runs — single query with .in()
        return mockEncodingRunsChain({
          data: [{
            id: 'enc-1',
            citation: '26 USC 1',
            session_id: 'sess-1',
            file_path: 'statute/26/1.yaml',
            rulespec_content: 'rule { ... }',
            final_scores: { rulespec: 90, formula: 85, parameter: 80, integration: 75 },
          }],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-1')
      expect(result).toEqual({
        encoding_run_id: 'enc-1',
        citation: '26 USC 1',
        session_id: 'sess-1',
        file_path: 'statute/26/1.yaml',
        rulespec_content: 'rule { ... }',
        final_scores: { rulespec: 90, formula: 85, parameter: 80, integration: 75 },
        iterations: null,
        total_duration_ms: null,
        agent_type: null,
        agent_model: null,
        data_source: null,
        has_issues: null,
        note: null,
        timestamp: null,
        encoder_version: null,
      })
    })

    it('picks the most specific path when multiple matches exist', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/32/b/1', jurisdiction: 'us', rulespec_path: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        // Return both a parent and child match — should pick child (more specific).
        // Paths are stored under the plural ``statutes/`` bucket because that
        // is the canonical layout in the rulespec-* repos; candidatePaths
        // translates the citation_path doc-type segment to match.
        return mockEncodingRunsChain({
          data: [
            { id: 'enc-parent', citation: '26 USC 32/b', session_id: null, file_path: 'statutes/26/32/b.yaml', rulespec_content: 'parent', final_scores: null },
            { id: 'enc-child', citation: '26 USC 32/b/1', session_id: null, file_path: 'statutes/26/32/b/1.yaml', rulespec_content: 'child', final_scores: null },
          ],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-1')
      expect(result?.encoding_run_id).toBe('enc-child')
      expect(result?.file_path).toBe('statutes/26/32/b/1.yaml')
    })

    it('checks duplicated terminal section file paths for US section roots', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/24', jurisdiction: 'us', rulespec_path: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({
          data: [{
            id: 'enc-root',
            citation: '26 USC 24',
            session_id: null,
            file_path: 'statute/26/24/24.yaml',
            rulespec_content: 'root section encoding',
            final_scores: null,
          }],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-root')
      expect(result?.encoding_run_id).toBe('enc-root')
      expect(result?.file_path).toBe('statute/26/24/24.yaml')
    })

    it('returns encoding-run metadata fields from encoding_runs', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/1', jurisdiction: 'us', rulespec_path: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({
          data: [{
            id: 'enc-1',
            citation: '26 USC 1',
            session_id: 'sess-1',
            file_path: 'statute/26/1.yaml',
            rulespec_content: 'rule { ... }',
            final_scores: null,
            iterations: [{ attempt: 1, success: true, duration_ms: 5000, errors: [] }],
            total_duration_ms: 5000,
            agent_type: 'encoder-v2',
            agent_model: 'claude-sonnet-4',
            data_source: 'reviewer_agent',
            has_issues: false,
            note: 'Clean run',
            timestamp: '2025-06-15T12:00:00Z',
            encoder_version: '0.4.2',
          }],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-1')
      expect(result?.agent_type).toBe('encoder-v2')
      expect(result?.agent_model).toBe('claude-sonnet-4')
      expect(result?.total_duration_ms).toBe(5000)
      expect(result?.data_source).toBe('reviewer_agent')
      expect(result?.has_issues).toBe(false)
      expect(result?.note).toBe('Clean run')
      expect(result?.iterations).toHaveLength(1)
      expect(result?.encoder_version).toBe('0.4.2')
      expect(result?.timestamp).toBe('2025-06-15T12:00:00Z')
    })

    it('uses rulespec_path when citation_path is null', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: null, jurisdiction: 'uk', rulespec_path: 'legislation/uksi/2013/376/regulation/36/3/childcare-one-child.yaml' },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({
          data: [{
            id: 'enc-uk-1',
            citation: 'uksi-2013-376 regulation 36(3) childcare one child',
            session_id: null,
            file_path: 'legislation/uksi/2013/376/regulation/36/3/childcare-one-child.yaml',
            rulespec_content: 'uk rule',
            final_scores: null,
          }],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-uk')
      expect(result?.encoding_run_id).toBe('enc-uk-1')
      expect(result?.file_path).toBe('legislation/uksi/2013/376/regulation/36/3/childcare-one-child.yaml')
    })

    it('returns null when rule has neither citation_path nor rulespec_path', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: { citation_path: null, jurisdiction: 'us', rulespec_path: null },
              error: null,
            }),
          }),
        }),
      })

      const result = await getRuleEncoding('rule-no-cp')
      expect(result).toBeNull()
    })

    it('returns null when rule fetch errors', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: null,
              error: { message: 'not found' },
            }),
          }),
        }),
      })

      const result = await getRuleEncoding('rule-missing')
      expect(result).toBeNull()
    })

    it('returns null when neither encoding_runs nor the rulespec-* repo has the path', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' })
      vi.stubGlobal('fetch', fetchMock)

      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/99', jurisdiction: 'us', rulespec_path: null, has_rulespec: false },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({ data: [], error: null })
      })

      const result = await getRuleEncoding('rule-no-encoding')
      expect(result).toBeNull()
      // Falls through to the rulespec-* fallback regardless of has_rulespec —
      // the corpus flag is unreliable during the rolling migration.
      expect(fetchMock).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('returns null when encoding_runs query errors', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/1', jurisdiction: 'us', rulespec_path: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({ data: null, error: { message: 'err' } })
      })

      const result = await getRuleEncoding('rule-err')
      expect(result).toBeNull()
    })

    it('falls back to the repo file when stored runs are telemetry-only (null content)', async () => {
      // Only the real repo file exists; ancestor/duplicated-terminal
      // probes 404 like they would against raw.githubusercontent.com.
      const fetchMock = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/us/statutes/26/32.yaml')
            ? { ok: true, text: async () => 'format: rulespec/v1\n' }
            : { ok: false, status: 404, text: async () => '' }
        )
      )
      vi.stubGlobal('fetch', fetchMock)

      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us/statute/26/32', jurisdiction: 'us', rulespec_path: null, has_rulespec: true },
                  error: null,
                }),
              }),
            }),
          }
        }
        // A stored run exists but carries no YAML — must not win.
        return mockEncodingRunsChain({
          data: [{ id: 'enc-empty', citation: '26 USC 32', session_id: 'sess-1', file_path: 'statutes/26/32.yaml', rulespec_content: null, final_scores: null }],
          error: null,
        })
      })

      const result = await getRuleEncoding('rule-32')
      expect(result?.encoding_run_id).toBe('github:statutes/26/32.yaml')
      expect(result?.rulespec_content).toBe('format: rulespec/v1\n')
      vi.unstubAllGlobals()
    })

    it('falls back to rulespec-us-co GitHub paths for Colorado rules', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'colorado rule',
      })
      vi.stubGlobal('fetch', fetchMock)

      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { citation_path: 'us-co/statute/crs/26-2-703/2.5', jurisdiction: 'us-co', rulespec_path: null, has_rulespec: true },
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockEncodingRunsChain({ data: [], error: null })
      })

      const result = await getRuleEncoding('rule-us-co')
      expect(result?.encoding_run_id).toBe('github:statutes/crs/26-2-703/2.5.yaml')
      // Colorado now lives under the us-co directory of the shared
      // rulespec-us monorepo, not a standalone rulespec-us-co repo.
      expect(fetchMock).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us-co/statutes/crs/26-2-703/2.5.yaml',
        expect.any(Object)
      )
      vi.unstubAllGlobals()
    })

    it('skips the corpus lookup for a synthesised github: id and fetches from rulespec-* directly', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'format: rulespec/v1\n',
      })
      vi.stubGlobal('fetch', fetchMock)

      // The corpus shouldn't be queried at all for synth ids — fail
      // hard if it is so the regression is loud.
      mockFrom.mockImplementation((table: string) => {
        if (table === 'current_provisions') {
          throw new Error('synthesised id should not query corpus')
        }
        return mockEncodingRunsChain({ data: [], error: null })
      })

      const result = await getRuleEncoding('github:us/statute/26/3101/a')
      // file_path stays bucket-rooted; the GitHub URL gains the
      // jurisdiction-dir prefix the monorepo layout requires.
      expect(result?.file_path).toBe('statutes/26/3101/a.yaml')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us/statutes/26/3101/a.yaml',
        expect.any(Object)
      )
      vi.unstubAllGlobals()
    })

    it('returns null for a synth id without a jurisdiction segment', async () => {
      const result = await getRuleEncoding('github:')
      expect(result).toBeNull()
    })

    it('refuses the GitHub fallback for a repo the app must not read', async () => {
      // rulespec-il is mapped (Israel gets a pending landing tile) but
      // gated app_visibility = "experimental". The rule-detail rail
      // must not serve its pilot YAML before promotion, so the
      // fallback fetcher never leaves the process.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'format: rulespec/v1\n',
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await getRuleEncoding(
        'github:il/statute/income-tax-ordinance/section-121'
      )
      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })
  })

  describe('searchRules', () => {
    it('returns an empty array for blank queries without hitting the RPC', async () => {
      const result = await searchRules('   ')
      expect(result).toEqual([])
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('calls the search_provisions RPC with trimmed query and default options', async () => {
      const hits = [
        {
          id: 'a',
          jurisdiction: 'us',
          doc_type: 'regulation',
          citation_path: 'us/regulation/7/273/9',
          heading: 'Income and deductions',
          snippet: '<mark>SNAP</mark>',
          has_rulespec: false,
          rank: 0.1,
        },
      ]
      mockRpc.mockResolvedValue({ data: hits, error: null })

      const result = await searchRules('  SNAP standard  ')
      expect(mockRpc).toHaveBeenCalledWith('search_provisions', {
        q: 'SNAP standard',
        jurisdiction_in: null,
        doc_type_in: null,
        limit_in: 30,
      })
      expect(result).toEqual(hits)
    })

    it('forwards jurisdiction, docType, and clamps the limit', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null })
      await searchRules('x', { jurisdiction: 'us', docType: 'statute', limit: 500 })
      expect(mockRpc).toHaveBeenCalledWith('search_provisions', {
        q: 'x',
        jurisdiction_in: 'us',
        doc_type_in: 'statute',
        limit_in: 100,
      })
    })

    it('clamps a below-minimum limit to 1', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null })
      await searchRules('x', { limit: 0 })
      expect(mockRpc).toHaveBeenCalledWith(
        'search_provisions',
        expect.objectContaining({ limit_in: 1 })
      )
    })

    it('falls back to a direct heading ILIKE when the RPC errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('boom') })

      // Wire up a chainable ``provisions`` builder that the fallback
      // walks through (ilike → not → order → limit) and returns one
      // synthetic hit so we can assert it was actually used.
      const fallbackRow = {
        id: 'r1',
        jurisdiction: 'us-co',
        doc_type: 'policy',
        citation_path: 'us-co/policy/co-cdhs-snap-page',
        heading: 'Supplemental Nutrition Assistance Program (SNAP)',
        body: null,
        has_rulespec: false,
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () =>
          Promise.resolve({ data: [fallbackRow], error: null }),
      } as never
      mockFrom.mockReturnValue(builder)

      const result = await searchRules('snap')
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'r1',
        citation_path: 'us-co/policy/co-cdhs-snap-page',
      })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('handles a null data response as an empty array', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      const result = await searchRules('anything')
      expect(result).toEqual([])
    })

    it('returns an empty list when the fallback finds nothing either', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') })
      const builder = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
      } as never
      mockFrom.mockReturnValue(builder)
      const result = await searchRules('xyzzy')
      expect(result).toEqual([])
    })

    it('forwards jurisdiction and doc_type filters into the fallback query', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') })
      const eqSpy = vi.fn()
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          eqSpy(...args)
          return builder
        },
        ilike: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
      } as never
      mockFrom.mockReturnValue(builder)
      await searchRules('snap', { jurisdiction: 'us-co', docType: 'policy' })
      expect(eqSpy).toHaveBeenCalledWith('jurisdiction', 'us-co')
      expect(eqSpy).toHaveBeenCalledWith('doc_type', 'policy')
    })

    it('escapes HTML and wraps each query term in <mark> in the fallback snippet', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') })
      const builder = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () =>
          Promise.resolve({
            data: [
              {
                id: 'r1',
                jurisdiction: 'us-co',
                doc_type: 'policy',
                citation_path: 'us-co/policy/x',
                heading: '<b>SNAP</b> & residency',
                body: null,
                has_rulespec: false,
              },
            ],
            error: null,
          }),
      } as never
      mockFrom.mockReturnValue(builder)
      const [hit] = await searchRules('snap residency')
      // ``<b>`` is escaped, the two terms are wrapped in <mark>.
      expect(hit.snippet).toContain('&lt;b&gt;')
      expect(hit.snippet).toMatch(/<mark>SNAP<\/mark>/)
      expect(hit.snippet).toMatch(/<mark>residency<\/mark>/)
    })
  })

  describe('getRuleReferences', () => {
    it('calls the get_provision_references RPC with citation_path_in', async () => {
      const rows = [
        {
          direction: 'outgoing',
          citation_text: '42 U.S.C. 9902',
          pattern_kind: 'usc',
          confidence: 1,
          start_offset: 0,
          end_offset: 10,
          other_citation_path: 'us/statute/42/9902',
          other_provision_id: 'x',
          other_heading: 'Definitions',
          target_resolved: true,
        },
      ]
      mockRpc.mockResolvedValue({ data: rows, error: null })
      const result = await getRuleReferences('us/statute/7/2014')
      expect(mockRpc).toHaveBeenCalledWith('get_provision_references', {
        citation_path_in: 'us/statute/7/2014',
      })
      expect(result).toEqual(rows)
    })

    it('returns an empty array on RPC error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('boom') })
      const result = await getRuleReferences('any')
      expect(result).toEqual([])
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('handles null data as empty', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      expect(await getRuleReferences('any')).toEqual([])
    })
  })

  describe('getAxiomStats', () => {
    function mockNavigationCount(count = 0) {
      const eq = vi.fn().mockResolvedValue({ count, error: null })
      const select = vi.fn().mockReturnValue({ eq })
      mockFrom.mockReturnValue({ select })
      return { eq, select }
    }

    it('calls the get_corpus_stats RPC and preserves its core payload', async () => {
      const stats = {
        provisions_count: 658899,
        references_count: 148604,
        jurisdictions_count: 17,
        jurisdictions: [
          { jurisdiction: 'us', count: 467993 },
          { jurisdiction: 'us-dc', count: 130617 },
        ],
      }
      mockRpc.mockResolvedValue({ data: stats, error: null })
      mockNavigationCount(0)
      const result = await getAxiomStats()
      expect(mockRpc).toHaveBeenCalledWith('get_corpus_stats')
      expect(result).toMatchObject({
        provisions_count: stats.provisions_count,
        references_count: stats.references_count,
        jurisdictions_count: expect.any(Number),
      })
      expect(result?.jurisdictions).toEqual(
        expect.arrayContaining(stats.jurisdictions)
      )
    })

    it('fills missing landing jurisdiction counts from navigation_nodes', async () => {
      const stats = {
        provisions_count: 658899,
        references_count: 148604,
        jurisdictions_count: 1,
        jurisdictions: [{ jurisdiction: 'us', count: 467993 }],
      }
      mockRpc.mockResolvedValue({ data: stats, error: null })
      const eq = vi.fn((_column: string, jurisdiction: string) =>
        Promise.resolve({
          count: jurisdiction === 'ca' ? 22275 : 0,
          error: null,
        })
      )
      const select = vi.fn().mockReturnValue({ eq })
      mockFrom.mockReturnValue({ select })

      const result = await getAxiomStats()

      expect(mockFrom).toHaveBeenCalledWith('navigation_nodes')
      expect(result?.jurisdictions).toEqual(
        expect.arrayContaining([
          { jurisdiction: 'us', count: 467993 },
          { jurisdiction: 'ca', count: 22275 },
        ])
      )
      expect(result?.jurisdictions_count).toBeGreaterThanOrEqual(2)
    })

    it('fills Belgium family counts from RuleSpec GitHub when the encodings index is unavailable', async () => {
      const stats = {
        provisions_count: 658899,
        references_count: 148604,
        jurisdictions_count: 1,
        jurisdictions: [{ jurisdiction: 'us', count: 467993 }],
      }
      const rulespecCounts: Record<string, number> = {
        be: 58,
        'be-bru': 12,
        'be-vlg': 7,
        'be-wal': 6,
        'be-dg': 2,
        ca: 106,
      }
      mockRpc.mockResolvedValue({ data: stats, error: null })
      mockListEncodedFiles.mockImplementation(async (jurisdiction: string) =>
        Array.from({ length: rulespecCounts[jurisdiction] ?? 0 }, (_, i) => ({
          filePath: `statutes/example/${i}.yaml`,
          citationPath: `${jurisdiction}/statute/example/${i}`,
          bucket: 'statutes',
        }))
      )

      mockFrom.mockImplementation((table: string) => {
        const eq = vi.fn((_column: string, _jurisdiction: string) =>
          Promise.resolve(
            table === 'rulespec_files'
              ? {
                  count: null,
                  error: {
                    code: 'PGRST205',
                    message:
                      "Could not find the table 'encodings.rulespec_files' in the schema cache",
                  },
                }
              : { count: 0, error: null }
          )
        )
        const select = vi.fn().mockReturnValue({ eq })
        return { select }
      })

      const result = await getAxiomStats()

      expect(mockListEncodedFiles).toHaveBeenCalledWith('be')
      expect(mockListEncodedFiles).toHaveBeenCalledWith('be-bru')
      expect(mockListEncodedFiles).toHaveBeenCalledWith('be-vlg')
      expect(mockListEncodedFiles).toHaveBeenCalledWith('be-wal')
      expect(mockListEncodedFiles).toHaveBeenCalledWith('be-dg')
      // Any stats-missing jurisdiction with a published repo may be
      // probed (graceful degradation); Canada fills from GitHub too.
      expect(mockListEncodedFiles).toHaveBeenCalledWith('ca')
      expect(result?.jurisdictions).toEqual(
        expect.arrayContaining([
          { jurisdiction: 'be', count: 58 },
          { jurisdiction: 'be-bru', count: 12 },
          { jurisdiction: 'be-vlg', count: 7 },
          { jurisdiction: 'be-wal', count: 6 },
          { jurisdiction: 'ca', count: 106 },
          { jurisdiction: 'be-dg', count: 2 },
        ])
      )
      expect(result?.jurisdictions_count).toBeGreaterThanOrEqual(6)
    })

    it('never counts a gated pilot family from the encodings index', async () => {
      // The landing tile count is a database read like any other. A
      // leaked rulespec_files row would have lit Israel's tile with a
      // rule count and a live /il link while every reader on the site
      // refuses to serve those files.
      const stats = {
        provisions_count: 658899,
        references_count: 148604,
        jurisdictions_count: 1,
        jurisdictions: [{ jurisdiction: 'us', count: 467993 }],
      }
      mockRpc.mockResolvedValue({ data: stats, error: null })
      mockListEncodedFiles.mockResolvedValue([])

      const countedJurisdictions: string[] = []
      mockFrom.mockImplementation((table: string) => {
        const eq = vi.fn((_column: string, jurisdiction: string) => {
          if (table === 'rulespec_files') countedJurisdictions.push(jurisdiction)
          return Promise.resolve(
            table === 'rulespec_files'
              ? { count: 42, error: null }
              : { count: 0, error: null }
          )
        })
        const select = vi.fn().mockReturnValue({ eq })
        return { select }
      })

      const result = await getAxiomStats()

      expect(countedJurisdictions).not.toContain('il')
      // Illinois is a US state, not Israel — it must still be counted.
      expect(countedJurisdictions).toContain('us-il')
      expect(
        result?.jurisdictions?.some((j) => j.jurisdiction === 'il')
      ).toBe(false)
      expect(mockListEncodedFiles).not.toHaveBeenCalledWith('il')
    })

    it('keeps Belgium counts from the bootstrap seed when GitHub RuleSpec listing is unavailable', async () => {
      const stats = {
        provisions_count: 658899,
        references_count: 148604,
        jurisdictions_count: 1,
        jurisdictions: [{ jurisdiction: 'us', count: 467993 }],
      }
      mockRpc.mockResolvedValue({ data: stats, error: null })
      mockListEncodedFiles.mockResolvedValue([])

      mockFrom.mockImplementation((table: string) => {
        const eq = vi.fn((_column: string, _jurisdiction: string) =>
          Promise.resolve(
            table === 'rulespec_files'
              ? {
                  count: null,
                  error: {
                    code: 'PGRST205',
                    message:
                      "Could not find the table 'encodings.rulespec_files' in the schema cache",
                  },
                }
              : { count: 0, error: null }
          )
        )
        const select = vi.fn().mockReturnValue({ eq })
        return { select }
      })

      const result = await getAxiomStats()

      expect(result?.jurisdictions).toEqual(
        expect.arrayContaining([
          { jurisdiction: 'be', count: 58 },
          { jurisdiction: 'be-bru', count: 12 },
          { jurisdiction: 'be-vlg', count: 7 },
          { jurisdiction: 'be-wal', count: 6 },
          { jurisdiction: 'be-dg', count: 2 },
        ])
      )
    })

    it('returns null on RPC error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockRpc.mockResolvedValue({ data: null, error: new Error('timeout') })
      const result = await getAxiomStats()
      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('returns null when the RPC returns null data', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      expect(await getAxiomStats()).toBeNull()
    })
  })
})
