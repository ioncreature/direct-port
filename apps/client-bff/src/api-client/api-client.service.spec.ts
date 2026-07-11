import axios from 'axios';
import FormData from 'form-data';
import { ApiClientService } from './api-client.service';

function createService() {
  const http = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  jest.spyOn(axios, 'create').mockReturnValue(http as any);

  const config = {
    get: jest.fn((key: string, def: string) => {
      if (key === 'API_BASE_URL') return 'http://api.test/api';
      if (key === 'API_INTERNAL_KEY') return 'internal-key-test';
      return def;
    }),
  };
  const service = new ApiClientService(config as any);
  return { service, http };
}

afterEach(() => jest.restoreAllMocks());

describe('ApiClientService', () => {
  it('создаёт axios-клиент с базовым URL и X-Internal-Key из конфига', () => {
    createService();
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://api.test/api',
        headers: { 'X-Internal-Key': 'internal-key-test' },
      }),
    );
  });

  it('createTopUp: accountId попадает в путь, payload — в тело', async () => {
    const { service, http } = createService();
    await service.createTopUp('acc-1', { packageKey: 'p500', telegramUserId: 'tgu-1' });
    expect(http.post).toHaveBeenCalledWith('/internal/client/acc-1/topups', {
      packageKey: 'p500',
      telegramUserId: 'tgu-1',
    });
  });

  it('cancelTopUp: оба id в пути, скоуп по аккаунту сохраняется', async () => {
    const { service, http } = createService();
    await service.cancelTopUp('acc-1', 'topup-9');
    expect(http.post).toHaveBeenCalledWith('/internal/client/acc-1/topups/topup-9/cancel', {});
  });

  it('getBalance/getDocument: ресурсные пути скоупятся по accountId', async () => {
    const { service, http } = createService();
    await service.getBalance('acc-1');
    expect(http.get).toHaveBeenCalledWith('/internal/client/acc-1/balance');
    await service.getDocument('acc-1', 'doc-7');
    expect(http.get).toHaveBeenCalledWith('/internal/client/acc-1/documents/doc-7');
  });

  it('uploadDocument: форвардит multipart с telegramUserId полем формы', async () => {
    const { service, http } = createService();
    await service.uploadDocument('acc-1', 'tgu-1', Buffer.from('bytes'), 'invoice.xlsx');

    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, form, options] = http.post.mock.calls[0];
    expect(url).toBe('/internal/client/acc-1/documents');
    expect(form).toBeInstanceOf(FormData);
    // В multipart-теле есть и файл с исходным именем, и telegramUserId из JWT.
    const body = (form as FormData).getBuffer().toString('utf8');
    expect(body).toContain('name="telegramUserId"');
    expect(body).toContain('tgu-1');
    expect(body).toContain('filename="invoice.xlsx"');
    expect(options.headers).toEqual((form as FormData).getHeaders());
  });

  it('getCompany: slug уходит query-параметром, без slug — без параметров', async () => {
    const { service, http } = createService();
    await service.getCompany('acme');
    expect(http.get).toHaveBeenCalledWith('/internal/client/company', {
      params: { slug: 'acme' },
    });
    await service.getCompany();
    expect(http.get).toHaveBeenCalledWith('/internal/client/company', { params: undefined });
  });

  it('downloadDocument: возвращает буфер и заголовки, с дефолтами при их отсутствии', async () => {
    const { service, http } = createService();
    http.get.mockResolvedValue({
      data: Buffer.from('xlsx-bytes'),
      headers: {},
    });

    const result = await service.downloadDocument('acc-1', 'doc-7');

    expect(http.get).toHaveBeenCalledWith(
      '/internal/client/acc-1/documents/doc-7/download',
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
    expect(result.buffer.equals(Buffer.from('xlsx-bytes'))).toBe(true);
    expect(result.contentType).toContain('spreadsheetml');
    expect(result.contentDisposition).toBe('attachment');
  });
});
