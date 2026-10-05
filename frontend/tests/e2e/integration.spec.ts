import { expect, test } from '@playwright/test';
import { DATASET, installMockApi } from './fixtures/mockApi';

/** Integration-plan scenarios on route fixtures (UI behaviour only; not real-data or real-AI verification). */
const ws = (sceneId: number, extra = '') => `/scenes/${sceneId}?dataset=${DATASET.id}${extra}`;

test.describe('IT-02/03/04 준비 상태·출처', () => {
  test('VESPA 설정만 확인된 상태는 실행을 막고, 환경 확인(읽기 전용) 후에만 실행할 수 있다', async ({ page }) => {
    const log = await installMockApi(page, { status: { vespa: 'configured-then-ready' } });
    await page.goto(ws(21));
    const run = page.getByTestId('run-job-single');
    await expect(page.getByTestId('vespa-readiness-single')).toHaveAttribute('data-reason', 'EXECUTOR_NOT_CHECKED');
    await expect(run).toBeDisabled();
    await page.getByRole('button', { name: '실행 환경 확인' }).click();
    await expect(run).toBeEnabled();
    expect(log.statusCalls.some((c) => c.refresh)).toBe(true);
    expect(log.jobPosts).toHaveLength(0); // checking the environment never creates work
    await expect(page.getByTestId('vespa-ready-single')).toContainText('실제 추론 성공을 보장하는 확인은 아니에요');
  });

  test('합성 데이터는 목록·작업대에 테스트 배지를 보이고 실제 VESPA 실행을 막는다 (센서 탐색은 유지)', async ({ page }) => {
    const log = await installMockApi(page, { status: { origin: 'SYNTHETIC' } });
    await page.goto(`/scenes?dataset=${DATASET.id}`);
    await expect(page.getByTestId('origin-badge')).toHaveText(/테스트 데이터/);
    await page.goto(ws(21, '&view=six'));
    await expect(page.getByTestId('origin-badge')).toHaveAttribute('data-origin', 'SYNTHETIC');
    await expect(page.getByTestId('vespa-readiness-single')).toHaveAttribute('data-reason', 'SYNTHETIC_DATASET');
    await expect(page.getByRole('button', { name: '실행 환경 확인' })).toHaveCount(0);
    await expect(page.getByTestId('run-job-single')).toBeDisabled();
    await expect(page.locator('.cam-media[data-state="ready"]')).toHaveCount(6);
    expect(log.jobPosts).toHaveLength(0);
  });

  test('준비 상태 API가 없는 이전 서버는 실행을 막고 출처 정보 없음으로 표시한다', async ({ page }) => {
    await installMockApi(page, { status: { missing: true } });
    await page.goto(ws(21));
    await expect(page.getByTestId('origin-badge').or(page.getByText('출처 정보 없음'))).toBeVisible();
    await expect(page.getByTestId('vespa-readiness-single')).toHaveAttribute('data-reason', 'STATUS_API_UNSUPPORTED');
    await expect(page.getByTestId('run-job-single')).toBeDisabled();
    await expect(page.locator('.cam-media[data-state="ready"]').first()).toBeVisible();
  });

  test('임베딩이 없으면 검색을 막고 이유를 보이며 씬 목록은 유지한다', async ({ page }) => {
    let searchCalls = 0;
    page.on('request', (r) => { if (r.url().includes('/api/search/scenes')) searchCalls++; });
    await installMockApi(page, { status: { search: 'UNAVAILABLE' } });
    await page.goto(`/scenes?dataset=${DATASET.id}`);
    await expect(page.getByTestId('search-readiness')).toHaveAttribute('data-reason', 'EMBEDDINGS_NOT_READY');
    await page.getByLabel('씬 검색어').fill('rain');
    await expect(page.getByRole('button', { name: '검색', exact: true })).toBeDisabled();
    await expect(page.locator('.scene-card')).toHaveCount(3);
    await page.goto(`/scenes?dataset=${DATASET.id}&q=rain`);
    await expect(page.getByText('이 데이터셋에서는 지금 검색할 수 없어요')).toBeVisible();
    expect(searchCalls).toBe(0);
  });

  test('다른 서버(instance)로 바뀌면 이전 서버의 작업 기록을 연결하지 않는다', async ({ page }) => {
    await installMockApi(page, { status: { instanceId: 'aaaaaaaa-0000-4000-8000-000000000001' }, jobSequence: ['RUNNING'] });
    await page.goto(ws(21));
    await page.getByTestId('run-job-single').click();
    await expect(page.getByTestId('job-card-single')).toContainText('작업 #41');
    await page.unroute('**/api/**');
    await installMockApi(page, { status: { instanceId: 'bbbbbbbb-0000-4000-8000-000000000002' }, jobSequence: ['RUNNING'] });
    await page.goto(ws(21));
    await expect(page.getByText('아직 연결된 작업이 없어요')).toBeVisible();
    await expect(page.getByTestId('job-card-single')).toHaveCount(0);
  });
});

test.describe('IT-05 오류 원인', () => {
  test('upstream 404 실패는 timeout이 아니라 미지원으로 안내하고, 실행 환경이 없으면 재실행을 막는다', async ({ page }) => {
    await installMockApi(page, { jobSequence: ['FAILED'], failedErrorCode: 'AI_ENDPOINT_UNSUPPORTED', status: { vespa: 'UNAVAILABLE' } });
    await page.goto(ws(21, '&job=41'));
    const card = page.getByTestId('job-card-single');
    await expect(card.locator('[data-error-code="AI_ENDPOINT_UNSUPPORTED"]')).toBeVisible();
    await expect(card).toContainText('연결된 AI 서버가 이 기능을 제공하지 않아요');
    await expect(card).not.toContainText('timed out');
    await expect(card.getByRole('button', { name: /다시 실행/ })).toBeDisabled();
  });
});

test.describe('IT-06/07 요청 snapshot', () => {
  test('응답 전에 다른 씬으로 이동하면 새 씬에 작업을 연결하지 않고 원래 씬 이력에만 남긴다', async ({ page }) => {
    const log = await installMockApi(page, { postDelayMs: 1500, jobSequence: ['RUNNING'] });
    await page.goto(ws(21));
    await page.getByTestId('run-job-single').click();
    await page.getByRole('link', { name: '씬 목록' }).click(); // client-side navigation keeps the request alive
    await page.getByRole('link', { name: /scene-0103 열기/ }).click();
    await expect(page.getByRole('heading', { name: 'scene-0103' })).toBeVisible();
    await expect.poll(() => log.jobPosts.length).toBe(1);
    await page.waitForTimeout(1800); // answer arrives while scene-0103 is open
    await expect(page.getByText('아직 연결된 작업이 없어요')).toBeVisible();
    const receipts = await page.evaluate(() => JSON.parse(localStorage.getItem('ds2l.jobReceipts.v2') ?? '{"data":[]}').data);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ jobId: 41, sceneToken: 'scene-tok-61', sceneId: 21, paneId: 'single', classMode: 8 });
    // back on the original scene its history shows the job
    await page.getByRole('link', { name: '씬 목록' }).click();
    await page.getByRole('link', { name: /scene-0061 열기/ }).click();
    await expect(page.getByTestId('job-card-single')).toContainText('작업 #41');
  });

  test('A→B→A로 돌아와 사용자가 고른 작업을 늦은 응답이 덮어쓰지 않는다', async ({ page }) => {
    await installMockApi(page, { postDelayMs: 2000, jobSequence: ['RUNNING'] });
    await page.goto(ws(21));
    await page.getByTestId('run-job-single').click();
    await page.getByRole('link', { name: '씬 목록' }).click();
    await page.getByRole('link', { name: /scene-0103 열기/ }).click();
    await page.getByRole('link', { name: '씬 목록' }).click();
    await page.getByRole('link', { name: /scene-0061 열기/ }).click();
    await page.getByPlaceholder('작업 번호로 열기').fill('77');
    await page.getByRole('button', { name: '열기', exact: true }).click();
    await expect(page.getByTestId('job-card-single')).toContainText('작업 #77');
    await page.waitForTimeout(2300);
    await expect(page.getByTestId('job-card-single')).toContainText('작업 #77');
  });

  test('비교 화면에서 작업 대상을 바꿔도 응답은 요청한 패널에만 연결된다', async ({ page }) => {
    await installMockApi(page, { postDelayMs: 1500, jobSequence: ['RUNNING'] });
    await page.goto(`/compare?datasetA=${DATASET.id}&sceneA=21&datasetB=${DATASET.id}&sceneB=22`);
    await page.getByTestId('run-job-A').click();
    await page.getByRole('radio', { name: /B scene-0103/ }).click();
    await page.waitForTimeout(1800);
    await expect(page.getByText('아직 연결된 작업이 없어요')).toBeVisible(); // pane B
    await page.getByRole('radio', { name: /A scene-0061/ }).click();
    await expect(page.getByTestId('job-card-A')).toContainText('작업 #41');
  });

  test('응답 유실 후 "같은 요청 다시 보내기"는 같은 key를 쓰고, 새 실행은 새 key를 쓴다', async ({ page }) => {
    const log = await installMockApi(page, { postAborts: 3, jobSequence: ['FAILED'], failedErrorCode: 'VESPA_EXECUTION_FAILED' });
    await page.goto(ws(21));
    await page.getByTestId('run-job-single').click();
    await expect(page.getByText('요청 결과를 확인하지 못했어요')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '같은 요청 다시 보내기' }).click();
    await expect(page.getByTestId('job-card-single')).toContainText('작업 #41');
    const keys = new Set(log.jobPosts.map((p) => p.key));
    expect(log.jobPosts.length).toBe(4);
    expect(keys.size).toBe(1);
    await page.getByRole('button', { name: '새 작업으로 다시 실행' }).click();
    await expect.poll(() => log.jobPosts.length).toBe(5);
    expect(log.jobPosts[4]!.key).not.toBe(log.jobPosts[0]!.key);
  });
});

test.describe('IT-10 라벨 토글 적용 범위', () => {
  test('GT/예측 토글은 카메라 라벨 범위로 표시되고 패널별로 독립이다', async ({ page }) => {
    await installMockApi(page, { recording: 'ready' });
    await page.goto(`/compare?datasetA=${DATASET.id}&sceneA=21&datasetB=${DATASET.id}&sceneB=21`);
    await expect(page.locator('.pane--A').getByRole('group', { name: /카메라 라벨 레이어/ })).toBeVisible();
    await page.locator('.pane--A').getByRole('button', { name: 'GT', exact: true }).click();
    await expect(page.locator('.pane--A g[data-source="GT"]')).toHaveCount(0);
    await expect(page.locator('.pane--B g[data-source="GT"]').first()).toBeAttached();
    await page.goto(ws(21));
    await expect(page.getByTestId('recording-badge')).toContainText('카메라 라벨 토글과 별개');
  });
});
