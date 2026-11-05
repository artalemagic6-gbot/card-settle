# 카드 정산 서버

Node.js + SQLite 카드 정산 웹앱입니다. **봇이 카드사 엑셀을 받아 대기(staging)에 넣고**, 사이트에서 카드별로 **카드내역 불러오기** 한 뒤 분류·이름·메모를 맞춥니다. 정산 완료해도 내역은 삭제하지 않아 가계부/분석에 남습니다.

## 흐름

1. (봇) 카드사 엑셀을 받으면 `POST /api/staging/import` 로 대기열에 넣음  
2. 사이트에서 카드 선택 → **이용금액**·**계좌잔고** 반영 → **입금필요** 확인  
3. **카드내역 불러오기** → 해당 카드 대기 내역이 미정산 목록으로 복사 (중복 스킵, 기존 이력 유지)  
4. 카테고리·내용·메모 수정, 차액은 수기/개인차액 가상내역  
5. 맞춰지면 선택 → **정산완료**

입금필요 = max(0, 이용금액 − 계좌잔고). 352는 계좌잔고를 카드들이 공유합니다.

## 로컬 실행

```bash
cd card-settle-server
npm install
npm start
```

브라우저: http://127.0.0.1:3847  
환경변수: `PORT`(기본 3847), `HOST`(기본 0.0.0.0)

DB: `data/settle.db` (런타임 생성, git 제외)  
샘플: `../card-settle/sample-all-cards.xlsx` 이 있으면 빈 DB일 때 **staging**에만 자동 적재합니다.

```bash
npm run import-sample   # 샘플 → staging (서버 실행 중)
```

## 호스팅

- **GitHub Pages는 Node/SQLite를 돌릴 수 없습니다.** 정적 파일만 가능합니다.
- 이 앱은 **Render / Railway / Fly.io** 같은 Node 호스트에 올리거나, 지금은 이 박스에서 `npm start`로 쓰면 됩니다.
- `npm run build:static` → `dist/` 에 UI 셸만 복사 (API는 별도 서버 필요).

## 주요 API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/state` | 계좌·카드·규칙·대기 건수 |
| POST | `/api/staging/import` | 봇/스크립트: 엑셀 또는 JSON → staging |
| GET | `/api/staging/:id` | 카드별 대기 미리보기 |
| POST | `/api/cards/:id/load` | staging → txs (불러오기) |
| POST | `/api/upload` | (선택) 엑셀 직접 txs |
| GET/PATCH | `/api/txs` | 내역 조회·분류·이름·메모 |
| POST | `/api/txs/settle` | 정산완료 표시 |

## 카테고리

개인 · 데이트(결혼 생활비) · 부동산 · 크림 · 섬김비 · 연체 · 취미
