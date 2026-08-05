# Cost Analysis — Destination AI Step Functions Demo
**Region:** sa-east-1 (South America — Sao Paulo)
**Pricing model:** ON DEMAND
**Prices verified via:** AWS Pricing API + official OpenAI and AWS Bedrock pricing pages

---

## AWS Services identified (from code)

| Service | Machine | Detected in |
|---|---|---|
| AWS Step Functions EXPRESS | M1 | `StateMachineType.EXPRESS` in `destination-ai-stack.ts` |
| AWS Step Functions STANDARD | M2 | No `stateMachineType` → CDK default STANDARD in `destination-ai-stack.ts` |
| Amazon S3 GetObject | M1 and M2 | `arn:aws:states:::aws-sdk:s3:getObject` in both ASL files |
| OpenAI API (external, not AWS) | M1 | `arn:aws:states:::http:invoke` + `https://api.openai.com/v1/chat/completions` in `destination-ai.asl.json` |
| Amazon Bedrock InvokeModel | M2 | `arn:aws:states:::bedrock:invokeModel` in `confirm-destination.asl.json` |
| Amazon SNS Publish | M2 | `arn:aws:states:::sns:publish` in `confirm-destination.asl.json` |
| Amazon EventBridge Connection | M1 | `new Connection(...)` + `Authorization.apiKey(...)` in `destination-ai-stack.ts` |
| AWS Secrets Manager | M1 | `SecretValue.secretsManager("openai-api-key")` in `destination-ai-stack.ts` |
| Amazon CloudWatch Logs | M1 only | `logs: { destination: logGroups, level: LogLevel.ALL }` in `destination-ai-stack.ts`. M2 has no logs configured. |
| Amazon CloudWatch Dashboard | Both (metrics) | `new Dashboard(...)` in `cloudwatch-stack.ts` |
| Amazon API Gateway | External trigger | `new apigateway.RestApi(...)` in `destination-ai-stack.ts` |

No Lambda, DynamoDB, ECS or any other service in the execution flow. Verified by reading all states in `destination-ai.asl.json` and `confirm-destination.asl.json`.

---

## MACHINE 1 — `DemoDestinationAiAutocomplete`

### Type and pricing model
**EXPRESS.** Source: `StateMachineType.EXPRESS` in `destination-ai-stack.ts`.

- Does not charge per state transition.
- Charges per number of executions ($0.000001/request) and duration in GB-seconds ($0.00001667/GB-s).
- Fixed memory: 64 MB (0.0625 GB), not configurable.

### Region
`sa-east-1` — based on README (`--region sa-east-1`). The `bin/stepfunctions-destination-ai.ts` has `env` commented out.

### ASL states (`statemachine/destination-ai.asl.json`)

| State | Type | Service | Notes |
|---|---|---|---|
| `Get Prompt for OpenAI` | Task | Amazon S3 GetObject | Reads `prompts/destination-prompt.txt`. Retry MaxAttempts=3, BackoffRate=2, IntervalSeconds=1 |
| `Call OpenAI for autocomplete destination` | Task | OpenAI API (external, HTTP Task) | `https://api.openai.com/v1/chat/completions`, model `gpt-5.6-luna`. Retry MaxAttempts=3, BackoffRate=2, IntervalSeconds=5, JitterStrategy=FULL. Catch → Fail |
| `Fail` | Fail | — | Terminal error state |

### Real prompt sizes (`demo-data/destination-prompt.txt`)
- Measured prompt: ~1,850 characters ≈ ~460 tokens
- Destination name (input): ~5 tokens
- **Total input: ~465 tokens**
- Estimated output (JSON response, example in README): ~350 tokens

### Verified prices

| Component | Price | Source |
|---|---|---|
| SFN Express Request | $0.000001 / request | AWS Pricing API — `SAE1-StepFunctions-Request` |
| SFN Express Duration | $0.00001667 / GB-s | AWS Pricing API — `SAE1-StepFunctions-GB-Second` |
| S3 GET request | $0.00000056 / request | AWS Pricing API — `SAE1-Requests-Tier2` |
| CloudWatch Logs ingestion | ~$0.76/GB | Estimate (us-east-1 $0.50/GB × regional factor ~1.5x) |
| OpenAI gpt-5.6-luna input | $0.20 / 1M tokens | Official OpenAI pricing page |
| OpenAI gpt-5.6-luna output | $1.20 / 1M tokens | Official OpenAI pricing page |

### Cost per execution M1 — HAPPY PATH (no retries)

**Assumed duration: 10 seconds** (S3 ~0.5s + OpenAI ~8s + overhead ~1.5s)

```
SFN Request:
  1 × $0.000001 = $0.0000010

SFN Duration:
  10s × 0.0625 GB = 0.625 GB-s
  0.625 × $0.00001667 = $0.0000104

S3 GetObject:
  1 × $0.00000056 = $0.0000006

CloudWatch Logs (LogLevel.ALL + includeExecutionData=true):
  ~5 KB / 1,048,576 × $0.76 = $0.0000036

OpenAI gpt-5.6-luna:
  Input:  465 / 1,000,000 × $0.20 = $0.0000930
  Output: 350 / 1,000,000 × $1.20 = $0.0004200
  OpenAI subtotal = $0.0005130

─────────────────────────────────────────────
TOTAL AWS M1:  $0.0000010 + $0.0000104 + $0.0000006 + $0.0000036 = $0.0000156
TOTAL M1:      $0.0000156 + $0.0005130 = $0.0005286 ≈ $0.000529
─────────────────────────────────────────────
```

### Cost per execution M1 — WORST CASE (automatic retries exhausted within the same execution)

**Worst case** means Step Functions automatically retrying a failed state as configured in the ASL — not the admin rejecting a suggestion.

**S3 Retry:** MaxAttempts=3 → up to 3 attempts. **OpenAI Retry:** MaxAttempts=3 → up to 3 attempts.
**Estimated total duration: ~60 seconds**

```
SFN Request:          1 × $0.000001              = $0.0000010
SFN Duration:         3.75 GB-s × $0.00001667   = $0.0000625
S3 (3 attempts):      3 × $0.00000056            = $0.0000017
CW Logs (~30 KB):     30 / 1,048,576 × $0.76    = $0.0000218
OpenAI (3 attempts):  3 × $0.0005130             = $0.0015390

─────────────────────────────────────────────
TOTAL M1 worst case: $0.0016260 ≈ $0.00163
─────────────────────────────────────────────
```

---

## MACHINE 2 — `DemoConfirmDestinationMachine`

### Type and pricing model
**STANDARD.** Source: no `stateMachineType` in `destination-ai-stack.ts` → CDK default = STANDARD.

- Charges per state transition ($0.0000375/transition).
- Does not charge for duration.
- Free tier: first 4,000 transitions/month at no cost.
- No CloudWatch Logs configured.

### ASL states (`statemachine/confirm-destination.asl.json`)

| State | Type | Service | Notes |
|---|---|---|---|
| `S3 Get prompt for Bedrock` | Task | Amazon S3 GetObject | Reads `prompts/bedrock-new-destination-prompt.txt`. No Retry |
| `Bedrock Generates news with Bedrock` | Task | Amazon Bedrock InvokeModel | `global.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5, Global Cross-region). Retry MaxAttempts=3. Catch → Success |
| `SNS Send email` | Task | Amazon SNS Publish | Publishes to email topic. No Retry |
| `Success` | Succeed | — | Reached if Bedrock fails (Catch) |

### Real prompt sizes (`demo-data/bedrock-new-destination-prompt.txt`)
- Measured prompt: ~330 characters ≈ ~85 tokens
- Destination name: ~5 tokens
- **Total input: ~90 tokens**
- `max_tokens: 300` in ASL. Estimated output: ~200 tokens

### Verified prices

| Component | Price | Source |
|---|---|---|
| SFN Standard Transition | $0.0000375 / transition | AWS Pricing API — `SAE1-StateTransition` |
| S3 GET request | $0.00000056 / request | AWS Pricing API — `SAE1-Requests-Tier2` |
| SNS Email (first 1,000/month) | $0.00 | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` free tier |
| SNS Email (after 1,000/month) | $0.0000200 / notification | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` |
| Bedrock Claude Haiku 4.5 input | $1.00 / 1M tokens | AWS Bedrock pricing — Global Cross-region, sa-east-1 |
| Bedrock Claude Haiku 4.5 output | $5.00 / 1M tokens | AWS Bedrock pricing — Global Cross-region, sa-east-1 |

### Cost per execution M2 — HAPPY PATH (no retries)

**Transitions: 3** — `S3GetPrompt` → `BedrockGenerates` → `SNSSendEmail`

```
SFN Transitions: 3 × $0.0000375  = $0.0001125
S3 GetObject:    1 × $0.00000056 = $0.0000006

Bedrock Claude Haiku 4.5:
  Input:  90 / 1,000,000 × $1.00  = $0.0000900
  Output: 200 / 1,000,000 × $5.00 = $0.0010000
  Bedrock subtotal = $0.0010900

SNS Email: $0.00 (free tier)

─────────────────────────────────────────────
TOTAL M2 happy path: $0.0001125 + $0.0000006 + $0.0010900 = $0.0012031 ≈ $0.00120
─────────────────────────────────────────────
```

### Cost per execution M2 — WORST CASE (Bedrock fails 3 times → Catch → Success, no SNS)

Retries within a STANDARD Task do not generate additional transitions → still 3 transitions.

```
SFN Transitions:      3 × $0.0000375    = $0.0001125
S3 GetObject:         1 × $0.00000056   = $0.0000006
Bedrock (3 attempts): 3 × $0.0010900    = $0.0032700
SNS: $0.00 (not executed)

─────────────────────────────────────────────
TOTAL M2 worst case: $0.0033831 ≈ $0.00338
─────────────────────────────────────────────
```

---

## Cost of 1 complete attempt (M1 accepted + M2)

```
Happy path:  $0.000529 + $0.001203 = $0.001732 ≈ $0.00173
Worst case:  $0.001626 + $0.003383 = $0.005009 ≈ $0.00501
```

---

## M1 only repeated (admin rejects and requests again)

Each rejection is a brand new complete execution of M1 — not an internal retry. The code defines no rejection limit.

| N rejections | M1 executions | M1 cost | + 1 M2 | Total cycle |
|---|---|---|---|---|
| N=1 | 2 | 2 × $0.000529 = $0.001058 | $0.001203 | **$0.002261** |
| N=3 | 4 | 4 × $0.000529 = $0.002116 | $0.001203 | **$0.003319** |
| N=5 | 6 | 6 × $0.000529 = $0.003174 | $0.001203 | **$0.004377** |

**Step-by-step for N=3:**
```
4 × $0.000529 = $0.002116
1 × $0.001203 = $0.001203
─────────────────────────
Total:          $0.003319
```

---

## Projection to 10 and 50 creation cycles (N=3 average rejections)

```
Cost per cycle: $0.003319

10 cycles (40 M1 + 10 M2):
  40 × $0.000529 = $0.021160
  10 × $0.001203 = $0.012030
  ─────────────────────────
  Total:           $0.033190 ≈ $0.033

50 cycles (200 M1 + 50 M2):
  200 × $0.000529 = $0.105800
   50 × $0.001203 = $0.060150
  ──────────────────────────
  Total:            $0.165950 ≈ $0.166
```

---

## Fixed monthly costs (do not scale with executions)

| Service | Cost/month | Source |
|---|---|---|
| CloudWatch Dashboard (1 dashboard) | $3.00 | AWS documentation |
| Secrets Manager (openai-api-key) | ~$0.40 | $0.40/secret/month |
| **Total fixed monthly** | **~$3.40** | |

The fixed monthly cost ($3.40) exceeds the variable cost of 10 complete cycles ($0.033).

---

## Cost distribution (50 cycles)

| Service | Cost | % |
|---|---|---|
| OpenAI gpt-5.6-luna | ~$0.1026 | ~62% |
| Bedrock Claude Haiku 4.5 | ~$0.0545 | ~33% |
| Step Functions | ~$0.0042 | ~2.5% |
| S3 + CW Logs | ~$0.0046 | ~2.5% |

---

## Recommendations

1. **Security — API Gateway has no authentication**: anyone with the URL can consume OpenAI/Bedrock credits and trigger emails to subscribers. Add an API Key + Usage Plan before leaving the endpoint public. Source: README and `destination-ai-stack.ts`.

2. **Security — CORS ALL_ORIGINS**: `allowOrigins: Cors.ALL_ORIGINS` in `destination-ai-stack.ts`. Restrict to the frontend domain in production.

3. **Reduce LogLevel in M1**: `LogLevel.ALL` with `includeExecutionData: true` logs all payloads including the full prompt and OpenAI response. Switch to `LogLevel.ERROR` in production.

4. **Reduce S3 retries**: `MaxAttempts=3` for a static file is excessive. Reduce to `MaxAttempts=1`.

5. **Hardcoded bucket name**: `"demo-statemachine-ai-destination-data-bucket"` in `destination-ai-stack.ts` will fail if deployed to multiple accounts/regions. Use a CDK-generated name (remove `bucketName`).

---

## Assumptions and sources

| Assumption | Value | Source |
|---|---|---|
| Region | sa-east-1 | README (`--region sa-east-1`) |
| M1 type | EXPRESS | `StateMachineType.EXPRESS` in `destination-ai-stack.ts` |
| M2 type | STANDARD | CDK default; `destination-ai-stack.ts` |
| EXPRESS memory | 64 MB (0.0625 GB) | AWS documentation (fixed, not configurable) |
| M1 duration happy path | 10s | Estimate (S3 ~0.5s + OpenAI ~8s + overhead ~1.5s) |
| M1 duration worst case | 60s | Estimate (3 S3 attempts + 3 OpenAI attempts + backoff waits) |
| OpenAI input tokens | ~465 | Measured in `demo-data/destination-prompt.txt` (~460) + destination (~5) |
| OpenAI output tokens | ~350 | Estimated from JSON example in README |
| Bedrock input tokens | ~90 | Measured in `demo-data/bedrock-new-destination-prompt.txt` (~85) + destination (~5) |
| Bedrock output tokens | ~200 | `max_tokens: 300` in `confirm-destination.asl.json`; email ~150 words |
| OpenAI gpt-5.6-luna price | $0.20/$1.20 per 1M in/out | Official OpenAI pricing page |
| Bedrock Claude Haiku 4.5 price | $1.00/$5.00 per 1M in/out | AWS Bedrock pricing — Global Cross-region, sa-east-1 |
| CW Logs ingestion sa-east-1 | ~$0.76/GB | Estimate (us-east-1 $0.50/GB × regional factor ~1.5x) |
| M2 transitions happy path | 3 | Counted in `confirm-destination.asl.json` |
| M2 transitions worst case | 3 | Retries within a Task do not generate additional transitions in STANDARD |
| Average rejections per cycle | 3 | Analyst assumption; code defines no rejection limit |
| SFN Express Request price | $0.000001/request | AWS Pricing API — `SAE1-StepFunctions-Request` |
| SFN Express Duration price | $0.00001667/GB-s | AWS Pricing API — `SAE1-StepFunctions-GB-Second` |
| SFN Standard Transition price | $0.0000375/transition | AWS Pricing API — `SAE1-StateTransition` |
| S3 GET price | $0.00000056/request | AWS Pricing API — `SAE1-Requests-Tier2` |
| SNS Email price (>1,000/month) | $0.0000200/notification | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` |
| CW Dashboard price | $3.00/month | AWS documentation |
| Secrets Manager price | $0.40/secret/month | AWS documentation |
