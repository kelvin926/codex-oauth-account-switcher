import type { ResetDetails } from '../../shared/features.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writeJsonAtomic } from '../atomicFile.js';
const ENDPOINT = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const nullableDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
export function parseResetDetails(value: any): ResetDetails {
  if (!value || !Array.isArray(value.credits)) throw new Error('초기화권 상세 응답을 읽을 수 없습니다.');
  return { available: Number.isSafeInteger(value.available_count) && value.available_count>=0 ? value.available_count : null,
    credits: value.credits.filter((v: any)=>typeof v?.id==='string').map((v: any)=>({
      id: v.id, title: typeof v.title==='string'?v.title:null, expiresAt: nullableDate(v.expires_at),
      grantedAt: nullableDate(v.granted_at), status: typeof v.status==='string'?v.status:'unknown'
    })), pending: false };
}
type Operation = { key: string; status: 'pending' | 'settled'; before: number | null; message: string };
export class ResetCreditService {
  constructor(private readonly file: string, private readonly request: typeof fetch = fetch) {}
  private async ledger(): Promise<Record<string,Operation>> {
    try {
      const value=JSON.parse(await readFile(this.file,'utf8'));
      if (!value || Array.isArray(value) || typeof value!=='object' || Object.values(value).some((v:any)=>!v || !['pending','settled'].includes(v.status) || typeof v.key!=='string')) throw new Error('Invalid ledger');
      return value;
    } catch(error) {
      if ((error as NodeJS.ErrnoException).code==='ENOENT') return {};
      throw new Error('초기화권 사용 기록을 확인할 수 없어 추가 소모를 차단했습니다.');
    }
  }
  private headers(token: string, id: string) { return { Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': id, 'Content-Type': 'application/json' }; }
  async inspect(token: string, id: string): Promise<ResetDetails> {
    const response = await this.request(ENDPOINT,{ headers: this.headers(token,id), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`초기화권 조회 실패 (HTTP ${response.status}). 재로그인 또는 갱신 후 시도해 주세요.`);
    const details = parseResetDetails(await response.json()); const ledger = await this.ledger(); const operation = ledger[id];
    if (operation?.status === 'pending') return { ...details,pending:true,message: '이전 사용 요청의 결과가 확실하지 않습니다. 중복 소모를 막기 위해 추가 사용을 차단했습니다. 공식 Codex에서 사용 결과를 확인해 주세요.' };
    return { ...details,message:operation?.message };
  }
  async consume(token: string, id: string): Promise<ResetDetails> {
    const details = await this.inspect(token,id);
    if (details.pending) throw new Error(details.message);
    if (details.available===null || details.available<1) throw new Error('사용 가능한 초기화권을 확인할 수 없습니다.');
    const ledger = await this.ledger(); const operation: Operation = { key: randomUUID(),status:'pending',before:details.available,message:'' };
    ledger[id]=operation;
    await writeJsonAtomic(this.file,ledger); // Durable intent BEFORE the irreversible request.
    let payload: any;
    try {
      const response=await this.request(`${ENDPOINT}/consume`,{ method:'POST',headers:this.headers(token,id),body:JSON.stringify({redeem_request_id:operation.key}),signal:AbortSignal.timeout(15000),redirect:'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload=await response.json();
      if (!['reset','nothing_to_reset','no_credit','already_redeemed'].includes(payload?.code)) throw new Error('Unknown result');
    } catch {
      throw new Error('초기화권 사용 결과가 확실하지 않습니다. 요청을 다시 보내지 않았습니다. 공식 Codex에서 결과를 확인해 주세요.');
    }
    operation.status='settled';
    operation.message=payload.code==='reset'?'초기화권 1개를 사용했습니다.':'초기화되지 않았습니다: '+payload.code;
    await writeJsonAtomic(this.file,ledger);
    try { return await this.inspect(token,id); }
    catch { return { available:null,credits:[],pending:false,message:`${operation.message} 잔여량 조회는 실패했습니다. 사용 버튼 대신 갱신을 눌러 주세요.` }; }
  }
}
