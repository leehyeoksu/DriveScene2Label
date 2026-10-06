import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DatasetManager } from './DatasetManager';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
function mount() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
 render(<QueryClientProvider client={client}><DatasetManager datasetId={1} onOpen={vi.fn()} /></QueryClientProvider>);
 fireEvent.click(screen.getByText('데이터 업로드 · 검색 준비'));
 return client;
}
it('starts indexing the selected dataset and displays actual coverage', async () => {
 const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
  if (url === '/api/dataset-ingestions') return json([]);
  if (options?.method === 'POST') return json({ id: 'job' });
  return json({ totalImages: 6, completedImages: 0 });
 });
 vi.stubGlobal('fetch', fetcher);
 const client = mount();
 await waitFor(() => expect(screen.getByRole('button', { name: '현재 데이터셋 임베딩 생성' })).toBeEnabled());
 fireEvent.click(screen.getByRole('button', { name: '현재 데이터셋 임베딩 생성' }));
 await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/datasets/1/index', expect.objectContaining({ method: 'POST' })));
 expect(screen.getByText('이미지 0 / 6개 준비')).toBeInTheDocument();
 client.clear();
});
it('stores relative file paths before committing the upload for import', async () => {
 const order: string[] = [];
 const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
  if (options?.method === 'POST') {
   order.push(url);
   if (url.endsWith('/files')) {
    expect((options.body as FormData).get('path')).toBe('v1.0-mini/scene.json');
    return new Response(null, { status: 204 });
   }
   return json({ id: 'job' });
  }
  return json(url.endsWith('/index') ? { totalImages: 6, completedImages: 0 } : []);
 });
 vi.stubGlobal('fetch', fetcher);
 const client = mount();
 const file = new File(['[]'], 'scene.json', { type: 'application/json' });
 Object.defineProperty(file, 'webkitRelativePath', { value: 'mini/v1.0-mini/scene.json' });
 fireEvent.change(screen.getByLabelText('원본 폴더'), { target: { files: [file] } });
 fireEvent.click(screen.getByRole('button', { name: '업로드하고 검색 준비' }));
 await waitFor(() => expect(order).toEqual(['/api/dataset-ingestions', '/api/dataset-ingestions/job/files', '/api/dataset-ingestions/job/complete']));
 client.clear();
});
