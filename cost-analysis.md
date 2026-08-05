# Análisis de Costos — Destination AI Step Functions Demo
**Región:** sa-east-1 (South America — Sao Paulo)
**Modelo de pricing:** ON DEMAND
**Fecha de precios:** verificados via AWS Pricing API + páginas oficiales OpenAI y AWS Bedrock

---

## Servicios AWS identificados (leyendo el código)

| Servicio | Máquina | Cómo se detectó |
|---|---|---|
| AWS Step Functions EXPRESS | M1 | `StateMachineType.EXPRESS` en `destination-ai-stack.ts` |
| AWS Step Functions STANDARD | M2 | Sin `stateMachineType` → default STANDARD en `destination-ai-stack.ts` |
| Amazon S3 GetObject | M1 y M2 | `arn:aws:states:::aws-sdk:s3:getObject` en ambos ASL |
| OpenAI API (externo, no AWS) | M1 | `arn:aws:states:::http:invoke` + `https://api.openai.com/v1/chat/completions` en `destination-ai.asl.json` |
| Amazon Bedrock InvokeModel | M2 | `arn:aws:states:::bedrock:invokeModel` en `confirm-destination.asl.json` |
| Amazon SNS Publish | M2 | `arn:aws:states:::sns:publish` en `confirm-destination.asl.json` |
| Amazon EventBridge Connection | M1 | `new Connection(...)` + `Authorization.apiKey(...)` en `destination-ai-stack.ts` |
| AWS Secrets Manager | M1 | `SecretValue.secretsManager("openai-api-key")` en `destination-ai-stack.ts` |
| Amazon CloudWatch Logs | M1 únicamente | `logs: { destination: logGroups, level: LogLevel.ALL }` en `destination-ai-stack.ts`. M2 no tiene logs. |
| Amazon CloudWatch Dashboard | Ambas (métricas) | `new Dashboard(...)` en `cloudwatch-stack.ts` |
| Amazon API Gateway | Trigger externo | `new apigateway.RestApi(...)` en `destination-ai-stack.ts` |

No hay Lambda, DynamoDB, ECS ni ningún otro servicio en el flujo de ejecución. Verificado leyendo todos los estados de `destination-ai.asl.json` y `confirm-destination.asl.json`.

---

## MÁQUINA 1 — `DemoDestinationAiAutocomplete`

### Tipo y modelo de pricing
**EXPRESS.** Fuente: `StateMachineType.EXPRESS` en `destination-ai-stack.ts`.

- No cobra por transiciones de estado.
- Cobra por número de ejecuciones ($0.000001/request) y duración en GB-segundos ($0.00001667/GB-s).
- Memoria fija: 64 MB (0.0625 GB), no configurable.

### Región
`sa-east-1` — basado en el README (`--region sa-east-1`). El `bin/stepfunctions-destination-ai.ts` tiene el `env` comentado.

### Estados del ASL (`statemachine/destination-ai.asl.json`)

| Estado | Tipo | Servicio | Notas |
|---|---|---|---|
| `Get Prompt for OpenAI` | Task | Amazon S3 GetObject | Lee `prompts/destination-prompt.txt`. Retry MaxAttempts=3, BackoffRate=2, IntervalSeconds=1 |
| `Call OpenAI for autocomplete destination` | Task | OpenAI API (externo, HTTP Task) | `https://api.openai.com/v1/chat/completions`, modelo `gpt-5.6-luna`. Retry MaxAttempts=3, BackoffRate=2, IntervalSeconds=5, JitterStrategy=FULL. Catch → Fail |
| `Fail` | Fail | — | Estado terminal de error |

### Tamaños de prompt reales (`demo-data/destination-prompt.txt`)
- Prompt medido: ~1,850 caracteres ≈ ~460 tokens
- Nombre del destino: ~5 tokens
- **Total input: ~465 tokens**
- Output estimado (JSON de respuesta, ejemplo en README): ~350 tokens

### Precios verificados

| Componente | Precio | Fuente |
|---|---|---|
| SFN Express Request | $0.000001 / request | AWS Pricing API — `SAE1-StepFunctions-Request` |
| SFN Express Duration | $0.00001667 / GB-s | AWS Pricing API — `SAE1-StepFunctions-GB-Second` |
| S3 GET request | $0.00000056 / request | AWS Pricing API — `SAE1-Requests-Tier2` |
| CloudWatch Logs ingestión | ~$0.76/GB | Estimado (us-east-1 $0.50/GB × factor regional ~1.5x) |
| OpenAI gpt-5.6-luna input | $0.20 / 1M tokens | Página oficial OpenAI |
| OpenAI gpt-5.6-luna output | $1.20 / 1M tokens | Página oficial OpenAI |

### Costo por ejecución M1 — CASO FELIZ (sin reintentos)

**Duración asumida: 10 segundos** (S3 ~0.5s + OpenAI ~8s + overhead ~1.5s)

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
  Input:  465 / 1,000,000 × $0.20  = $0.0000930
  Output: 350 / 1,000,000 × $1.20  = $0.0004200
  Subtotal OpenAI = $0.0005130

─────────────────────────────────────────────
TOTAL AWS M1:   $0.0000010 + $0.0000104 + $0.0000006 + $0.0000036 = $0.0000156
TOTAL M1:       $0.0000156 + $0.0005130 = $0.0005286 ≈ $0.000529
─────────────────────────────────────────────
```

### Costo por ejecución M1 — PEOR CASO (3 intentos S3 + 3 intentos OpenAI)

**Duración estimada: ~60 segundos**

```
SFN Request:       1 × $0.000001              = $0.0000010
SFN Duration:      3.75 GB-s × $0.00001667   = $0.0000625
S3 (3 intentos):   3 × $0.00000056           = $0.0000017
CW Logs (~30 KB):  30 / 1,048,576 × $0.76   = $0.0000218
OpenAI (3 intentos): 3 × $0.0005130          = $0.0015390

─────────────────────────────────────────────
TOTAL M1 peor caso: $0.0016260 ≈ $0.00163
─────────────────────────────────────────────
```

---

## MÁQUINA 2 — `DemoConfirmDestinationMachine`

### Tipo y modelo de pricing
**STANDARD.** Fuente: sin `stateMachineType` en `destination-ai-stack.ts` → CDK default = STANDARD.

- Cobra por transiciones de estado ($0.0000375/transición).
- No cobra por duración.
- Free tier: primeras 4,000 transiciones/mes gratuitas.
- No tiene CloudWatch Logs configurados.

### Estados del ASL (`statemachine/confirm-destination.asl.json`)

| Estado | Tipo | Servicio | Notas |
|---|---|---|---|
| `S3 Get prompt for Bedrock` | Task | Amazon S3 GetObject | Lee `prompts/bedrock-new-destination-prompt.txt`. Sin Retry |
| `Bedrock Generates news with Bedrock` | Task | Amazon Bedrock InvokeModel | `global.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5, Global Cross-region). Retry MaxAttempts=3. Catch → Success |
| `SNS Send email` | Task | Amazon SNS Publish | Publica al topic email. Sin Retry |
| `Success` | Succeed | — | Alcanzado si Bedrock falla (Catch) |

### Tamaños de prompt reales (`demo-data/bedrock-new-destination-prompt.txt`)
- Prompt medido: ~330 caracteres ≈ ~85 tokens
- Nombre del destino: ~5 tokens
- **Total input: ~90 tokens**
- `max_tokens: 300` en el ASL. Output estimado: ~200 tokens

### Precios verificados

| Componente | Precio | Fuente |
|---|---|---|
| SFN Standard Transition | $0.0000375 / transición | AWS Pricing API — `SAE1-StateTransition` |
| S3 GET request | $0.00000056 / request | AWS Pricing API — `SAE1-Requests-Tier2` |
| SNS Email (primeras 1,000/mes) | $0.00 | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` free tier |
| SNS Email (después de 1,000/mes) | $0.0000200 / notificación | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` |
| Bedrock Claude Haiku 4.5 input | $1.00 / 1M tokens | AWS Bedrock pricing — Global Cross-region, sa-east-1 |
| Bedrock Claude Haiku 4.5 output | $5.00 / 1M tokens | AWS Bedrock pricing — Global Cross-region, sa-east-1 |

### Costo por ejecución M2 — CASO FELIZ (sin reintentos)

**Transiciones: 3** — `S3GetPrompt` → `BedrockGenerates` → `SNSSendEmail`

```
SFN Transitions: 3 × $0.0000375  = $0.0001125
S3 GetObject:    1 × $0.00000056 = $0.0000006

Bedrock Claude Haiku 4.5:
  Input:  90 / 1,000,000 × $1.00  = $0.0000900
  Output: 200 / 1,000,000 × $5.00 = $0.0010000
  Subtotal Bedrock = $0.0010900

SNS Email: $0.00 (free tier)

─────────────────────────────────────────────
TOTAL M2 caso feliz: $0.0001125 + $0.0000006 + $0.0010900 = $0.0012031 ≈ $0.00120
─────────────────────────────────────────────
```

### Costo por ejecución M2 — PEOR CASO (Bedrock falla 3 veces → Catch → Success, sin SNS)

Los reintentos dentro de un Task STANDARD no generan transiciones adicionales → siguen siendo 3 transiciones.

```
SFN Transitions:   3 × $0.0000375  = $0.0001125
S3 GetObject:      1 × $0.00000056 = $0.0000006
Bedrock (3 intentos): 3 × $0.0010900 = $0.0032700
SNS: $0.00 (no se ejecuta)

─────────────────────────────────────────────
TOTAL M2 peor caso: $0.0033831 ≈ $0.00338
─────────────────────────────────────────────
```

---

## Costo de 1 intento completo (M1 aceptada + M2)

```
Caso feliz:  $0.000529 + $0.001203 = $0.001732 ≈ $0.00173
Peor caso:   $0.001626 + $0.003383 = $0.005009 ≈ $0.00501
```

---

## Solo M1 repetida (admin rechaza y vuelve a pedir)

Cada rechazo es una ejecución nueva y completa de M1. El código no define ningún límite de rechazos.

| N rechazos | Ejecuciones M1 | Costo M1 | + 1 M2 | Total ciclo |
|---|---|---|---|---|
| N=1 | 2 | 2 × $0.000529 = $0.001058 | $0.001203 | **$0.002261** |
| N=3 | 4 | 4 × $0.000529 = $0.002116 | $0.001203 | **$0.003319** |
| N=5 | 6 | 6 × $0.000529 = $0.003174 | $0.001203 | **$0.004377** |

**Cálculo N=3 paso a paso:**
```
4 × $0.000529 = $0.002116
1 × $0.001203 = $0.001203
─────────────────────────
Total:          $0.003319
```

---

## Proyección a 10 y 50 ciclos (N=3 rechazos promedio)

```
Costo por ciclo: $0.003319

10 ciclos (40 M1 + 10 M2):
  40 × $0.000529 = $0.021160
  10 × $0.001203 = $0.012030
  ─────────────────────────
  Total:           $0.033190 ≈ $0.033

50 ciclos (200 M1 + 50 M2):
  200 × $0.000529 = $0.105800
   50 × $0.001203 = $0.060150
  ──────────────────────────
  Total:            $0.165950 ≈ $0.166
```

---

## Costos fijos mensuales (no escalan con ejecuciones)

| Servicio | Costo/mes | Fuente |
|---|---|---|
| CloudWatch Dashboard (1 dashboard) | $3.00 | Documentación AWS |
| Secrets Manager (openai-api-key) | ~$0.40 | $0.40/secret/mes |
| **Total fijo mensual** | **~$3.40** | |

El costo fijo mensual ($3.40) supera el costo variable de 10 ciclos completos ($0.033).

---

## Distribución del costo (50 ciclos)

| Servicio | Costo | % |
|---|---|---|
| OpenAI gpt-5.6-luna | ~$0.1026 | ~62% |
| Bedrock Claude Haiku 4.5 | ~$0.0545 | ~33% |
| Step Functions | ~$0.0042 | ~2.5% |
| S3 + CW Logs | ~$0.0046 | ~2.5% |

---

## Optimizaciones recomendadas

1. **Seguridad — API Gateway sin autenticación**: cualquiera con la URL puede consumir créditos de OpenAI/Bedrock y disparar emails a suscriptores. Agregar API Key + Usage Plan antes de dejar el endpoint público. Fuente: README y `destination-ai-stack.ts`.

2. **Seguridad — CORS ALL_ORIGINS**: `allowOrigins: Cors.ALL_ORIGINS` en `destination-ai-stack.ts`. Restringir al dominio del frontend en producción.

3. **Reducir LogLevel en M1**: `LogLevel.ALL` con `includeExecutionData: true` registra todos los payloads incluyendo el prompt completo y la respuesta de OpenAI. Cambiar a `LogLevel.ERROR` en producción.

4. **Reducir reintentos de S3**: `MaxAttempts=3` para un archivo estático es excesivo. Reducir a `MaxAttempts=1`.

5. **Nombre de bucket hardcodeado**: `"demo-statemachine-ai-destination-data-bucket"` en `destination-ai-stack.ts` falla si se despliega en múltiples cuentas/regiones. Usar nombre generado por CDK.

---

## Supuestos y fuentes

| Supuesto | Valor | Fuente |
|---|---|---|
| Región | sa-east-1 | README (`--region sa-east-1`) |
| Tipo M1 | EXPRESS | `StateMachineType.EXPRESS` en `destination-ai-stack.ts` |
| Tipo M2 | STANDARD | CDK default; `destination-ai-stack.ts` |
| Memoria EXPRESS | 64 MB (0.0625 GB) | Documentación AWS (fijo, no configurable) |
| Duración M1 caso feliz | 10s | Estimado (S3 ~0.5s + OpenAI ~8s + overhead ~1.5s) |
| Duración M1 peor caso | 60s | Estimado (3 intentos S3 + 3 intentos OpenAI + backoff) |
| Tokens input OpenAI | ~465 | Medido en `demo-data/destination-prompt.txt` (~460) + destino (~5) |
| Tokens output OpenAI | ~350 | Estimado del ejemplo JSON en README |
| Tokens input Bedrock | ~90 | Medido en `demo-data/bedrock-new-destination-prompt.txt` (~85) + destino (~5) |
| Tokens output Bedrock | ~200 | `max_tokens: 300` en `confirm-destination.asl.json`; email ~150 palabras |
| Precio OpenAI gpt-5.6-luna | $0.20/$1.20 por 1M in/out | Página oficial OpenAI |
| Precio Bedrock Claude Haiku 4.5 | $1.00/$5.00 por 1M in/out | AWS Bedrock pricing — Global Cross-region, sa-east-1 |
| Precio CW Logs sa-east-1 | ~$0.76/GB | Estimado (us-east-1 $0.50/GB × factor regional ~1.5x) |
| Transiciones M2 caso feliz | 3 | Contadas en `confirm-destination.asl.json` |
| Transiciones M2 peor caso | 3 | Reintentos dentro de un Task no generan transiciones adicionales en STANDARD |
| N rechazos promedio | 3 | Supuesto del analista; el código no define límite |
| Precio SFN Express Request | $0.000001/request | AWS Pricing API — `SAE1-StepFunctions-Request` |
| Precio SFN Express Duration | $0.00001667/GB-s | AWS Pricing API — `SAE1-StepFunctions-GB-Second` |
| Precio SFN Standard Transition | $0.0000375/transición | AWS Pricing API — `SAE1-StateTransition` |
| Precio S3 GET | $0.00000056/request | AWS Pricing API — `SAE1-Requests-Tier2` |
| Precio SNS Email (>1,000/mes) | $0.0000200/notificación | AWS Pricing API — `SAE1-DeliveryAttempts-SMTP` |
| Precio CW Dashboard | $3.00/mes | Documentación AWS |
| Precio Secrets Manager | $0.40/secret/mes | Documentación AWS |
