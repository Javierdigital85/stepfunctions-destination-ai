# Travel Ecommerce — Análisis de Costos Completo (sa-east-1)

## Región y Modelo de Precios

- Región: sa-east-1 (South America — São Paulo)
- Modelo: ON DEMAND (pay-as-you-go)
- Sin free tier (después del primer año de cuenta AWS)
- Excepciones permanentes: Cognito primeros 10,000 MAU, CloudWatch primeros 3 dashboards, SNS primeros 1M publishes, DynamoDB primeros 25GB storage, S3 primeros 5GB storage

---

## Arquitectura — Servicios incluidos

| Stack | Servicios |
|-------|-----------|
| Backend | API Gateway REST (products + bookings), Lambda (x2: backend + booking), DynamoDB (x2 tablas) |
| Booking | Lambda (x2: notificationFunction + postConfirmationFunction), SQS (notificationQueue + DLQ), SNS (booking notifications) |
| Frontend | Amplify Hosting |
| Auth | Cognito (User Pool + Identity Pool) |
| Observabilidad | CloudWatch Dashboard |
| Media | S3 (media bucket), CloudFront Distribution (PRICE_CLASS_ALL) |
| AI Destinations | API Gateway REST (DestinationAI), Step Functions Express (DestinationAiMachine), Step Functions Standard (ConfirmDestinationMachine), Bedrock Claude 3 Haiku, SNS (new destination topic), S3 (prompts bucket) |

---

## Assumptions

- Lambda: 128MB de memoria, duración promedio 500ms
- DynamoDB PAY_PER_REQUEST: 70% reads / 30% writes
- Amplify: 10 deploys/mes, 5 min/build
- DestinationAiMachine (Express Workflow): duración ~5s, 64MB — 2 estados: S3 GetObject + HTTP Invoke OpenAI
- ConfirmDestinationMachine (Standard Workflow): 3 estados: S3 GetObject + Bedrock InvokeModel + SNS Publish
- Bedrock Claude 3 Haiku disponible en sa-east-1 bajo "Geo and In-region Cross-region Inference" — precio confirmado en AWS Pricing
- Tokens reales por ejecución de ConfirmDestination: ~90 input + ~200 output (basado en bedrock-new-destination-prompt.txt)
- Tráfico bajo: ~5,000 usuarios/mes, ~50,000 requests/mes
- Tráfico medio: ~25,000 usuarios/mes, ~250,000 requests/mes
- Tráfico alto: ~100,000 usuarios/mes, ~1,000,000 requests/mes
- Destinos nuevos: independiente del tráfico de usuarios (operación admin)

---

## Exclusiones

- Route 53 / dominio personalizado
- WAF
- Costos de transferencia de datos entre regiones
- Soporte AWS
- Costo de la API de OpenAI (servicio externo, no AWS)

---

## Precios Unitarios

| Servicio | Unidad | Precio (sa-east-1) | Free Tier Permanente |
|---------|--------|-------------------|----------------------|
| API Gateway REST | por millón de requests | $4.25 | No |
| Lambda — Requests | por millón de invocaciones | $0.20 | No |
| Lambda — Duration | por GB-segundo | $0.0000166667 | No |
| DynamoDB — Writes | por millón de WRU | $0.9375 | No (25GB storage sí) |
| DynamoDB — Reads | por millón de RRU | $0.1875 | No (25GB storage sí) |
| Amplify — Data Transfer | por GB | $0.15 | No |
| Amplify — Builds | por minuto de build | $0.01 | No |
| Amplify — Hosting Compute | por millón de requests | $0.30 | No |
| Cognito | por MAU sobre 10,000 | $0.0055 | Sí — primeros 10,000 MAU siempre gratis |
| CloudWatch Dashboard | por dashboard/mes | $3.00 | Sí — primeros 3 dashboards siempre gratis |
| Step Functions Standard | por state transition | $0.0000375 | Sí — primeras 4,000 transiciones/mes gratis |
| Step Functions Express — Requests | por request | $0.000001 | No |
| Step Functions Express — Duration | por GB-segundo | $0.0000166700 | No |
| Bedrock Claude 3 Haiku — Input | por 1K tokens | $0.00025 | No |
| Bedrock Claude 3 Haiku — Output | por 1K tokens | $0.00125 | No |
| SNS — Publishes | por millón | $0.50 | Sí — primeros 1,000,000 gratis |
| S3 — Storage | por GB/mes | $0.023 | Sí — primeros 5GB gratis |
| S3 — GET Requests | por 1,000 requests | $0.005 | No |
| SQS Standard — Requests | por millón | $0.40 | Sí — primeros 1,000,000/mes gratis |
| CloudFront — HTTPS Requests | por 10,000 requests | $0.022 | Sí — primeros 10M requests/mes gratis |
| CloudFront — Data Transfer | por GB (South America) | $0.114 | Sí — primeros 1TB/mes gratis |
| Secrets Manager — Secret | por secret/mes | $0.40 | No |
| Secrets Manager — API Requests | por 10,000 requests | $0.05 | No |

---

## Costo por Destino Turístico Nuevo

Cada destino nuevo ejecuta ambas máquinas de estado en secuencia:

| Componente | Detalle | Costo |
|-----------|---------|-------|
| DestinationAiMachine (Express) | 1 request + 0.064GB × 5s = 0.32 GB-s | $0.000063 |
| ConfirmDestinationMachine (Standard) | 3 state transitions × $0.0000375 | $0.0001125 |
| Bedrock Claude 3 Haiku | 90 input tokens + 200 output tokens | $0.000273 |
| SNS Publish | 1 email — dentro del free tier | $0.00 |
| S3 GetObject | 2 lecturas — dentro del free tier | $0.00 |
| **Total por destino nuevo** | | **~$0.000448** |

| Escenario | Costo mensual Step Functions + Bedrock |
|-----------|---------------------------------------|
| 10 destinos nuevos/mes | ~$0.005 (menos de 1 centavo) |
| 50 destinos nuevos/mes | ~$0.022 (2 centavos) |

---

## Costo Total Mensual por Nivel de Tráfico

### Tráfico Bajo — ~5,000 usuarios, ~50,000 requests/mes

| Servicio | Uso | Cálculo | Costo |
|---------|-----|---------|-------|
| API Gateway REST (products + bookings + DestinationAI) | ~100,010 requests | 100,010 × $4.25/M | $0.43 |
| Lambda — Requests (x2) | 50,000 invocaciones | 50,000 × $0.20/M | $0.01 |
| Lambda — Duration (x2) | 50,000 × 0.128GB × 0.5s = 3,200 GB-s | 3,200 × $0.0000166667 | $0.05 |
| DynamoDB — Writes | 15,000 WRU | 15,000 × $0.9375/M | $0.01 |
| DynamoDB — Reads | 35,000 RRU | 35,000 × $0.1875/M | $0.01 |
| Amplify — Data Transfer | 1 GB | 1 × $0.15 | $0.15 |
| Amplify — Builds | 10 deploys × 5 min = 50 min | 50 × $0.01 | $0.50 |
| Amplify — Hosting Compute | 50,000 requests | 50,000 × $0.30/M | $0.02 |
| Cognito | 5,000 MAU (bajo los 10,000 gratuitos) | $0.00 | $0.00 |
| CloudWatch Dashboard | 1 dashboard (dentro del free tier) | $0.00 | $0.00 |
| Step Functions Express (10 destinos) | 10 requests + 3.2 GB-s | $0.000063 | $0.00 |
| Step Functions Standard (10 destinos) | 30 state transitions | 30 × $0.0000375 | $0.00 |
| Bedrock Claude 3 Haiku (10 destinos) | 900 input + 2,000 output tokens | $0.000225 + $0.0025 | $0.003 |
| SNS (10 emails) | dentro del free tier | $0.00 | $0.00 |
| S3 prompts | dentro del free tier | $0.00 | $0.00 |
| Lambda — notificationFunction + postConfirmationFunction (x2) | ~50,000 invocaciones + duración | ~$0.01 + $0.05 | $0.06 |
| SQS notificationQueue + DLQ | ~50,000 mensajes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| SNS booking notifications | ~50,000 publishes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| S3 media bucket — Storage | ~0.5 GB imágenes de productos | dentro del free tier 5GB | $0.00 |
| S3 media bucket — GET Requests | ~5,000 requests (10% llegan a S3, resto sirve CloudFront caché) | 5,000 × $0.005/1,000 | $0.025 |
| CloudFront — HTTPS Requests | ~50,000 requests (dentro del free tier 10M/mes) | $0.00 | $0.00 |
| CloudFront — Data Transfer | ~1 GB (dentro del free tier 1TB/mes) | $0.00 | $0.00 |
| Cognito Identity Pool | gratuito — no tiene costo adicional | $0.00 | $0.00 |
| Secrets Manager | 2 secrets (github-travel-token + openai-api-key) | 2 × $0.40 | $0.80 |
| **TOTAL TRÁFICO BAJO** | | | **~$2.28/mes** |

---

### Tráfico Medio — ~25,000 usuarios, ~250,000 requests/mes

| Servicio | Uso | Cálculo | Costo |
|---------|-----|---------|-------|
| API Gateway REST (x3) | ~500,000 requests | 500,000 × $4.25/M | $2.13 |
| Lambda — Requests (x2) | 250,000 invocaciones | 250,000 × $0.20/M | $0.05 |
| Lambda — Duration (x2) | 250,000 × 0.128GB × 0.5s = 16,000 GB-s | 16,000 × $0.0000166667 | $0.27 |
| DynamoDB — Writes | 75,000 WRU | 75,000 × $0.9375/M | $0.07 |
| DynamoDB — Reads | 175,000 RRU | 175,000 × $0.1875/M | $0.03 |
| Amplify — Data Transfer | 5 GB | 5 × $0.15 | $0.75 |
| Amplify — Builds | 50 min | 50 × $0.01 | $0.50 |
| Amplify — Hosting Compute | 250,000 requests | 250,000 × $0.30/M | $0.08 |
| Cognito | 15,000 MAU → 5,000 sobre free tier | 5,000 × $0.0055 | $0.03 |
| CloudWatch Dashboard | 1 dashboard (free tier) | $0.00 | $0.00 |
| Step Functions Express (50 destinos) | 50 requests + 16 GB-s | $0.000317 | $0.00 |
| Step Functions Standard (50 destinos) | 150 state transitions | 150 × $0.0000375 | $0.01 |
| Bedrock Claude 3 Haiku (50 destinos) | 4,500 input + 10,000 output tokens | $0.001125 + $0.0125 | $0.014 |
| SNS (50 emails) | dentro del free tier | $0.00 | $0.00 |
| S3 prompts | dentro del free tier | $0.00 | $0.00 |
| Lambda — notificationFunction + postConfirmationFunction (x2) | ~250,000 invocaciones + duración | ~$0.05 + $0.27 | $0.32 |
| SQS notificationQueue + DLQ | ~250,000 mensajes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| SNS booking notifications | ~250,000 publishes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| S3 media bucket — Storage | ~2 GB imágenes | dentro del free tier 5GB | $0.00 |
| S3 media bucket — GET Requests | ~25,000 requests (10% llegan a S3, resto sirve CloudFront caché) | 25,000 × $0.005/1,000 | $0.125 |
| CloudFront — HTTPS Requests | ~250,000 requests (dentro del free tier 10M/mes) | $0.00 | $0.00 |
| CloudFront — Data Transfer | ~5 GB (dentro del free tier 1TB/mes) | $0.00 | $0.00 |
| Cognito Identity Pool | gratuito | $0.00 | $0.00 |
| Secrets Manager | 2 secrets (fijo) | 2 × $0.40 | $0.80 |
| **TOTAL TRÁFICO MEDIO** | | | **~$5.38/mes** |

---

### Tráfico Alto — ~100,000 usuarios, ~1,000,000 requests/mes

| Servicio | Uso | Cálculo | Costo |
|---------|-----|---------|-------|
| API Gateway REST (x3) | ~2,000,000 requests | 2,000,000 × $4.25/M | $8.50 |
| Lambda — Requests (x2) | 1,000,000 invocaciones | 1,000,000 × $0.20/M | $0.20 |
| Lambda — Duration (x2) | 1,000,000 × 0.128GB × 0.5s = 64,000 GB-s | 64,000 × $0.0000166667 | $1.07 |
| DynamoDB — Writes | 300,000 WRU | 300,000 × $0.9375/M | $0.28 |
| DynamoDB — Reads | 700,000 RRU | 700,000 × $0.1875/M | $0.13 |
| Amplify — Data Transfer | 20 GB | 20 × $0.15 | $3.00 |
| Amplify — Builds | 50 min | 50 × $0.01 | $0.50 |
| Amplify — Hosting Compute | 1,000,000 requests | 1,000,000 × $0.30/M | $0.30 |
| Cognito | 100,000 MAU → 90,000 sobre free tier | 90,000 × $0.0055 | $0.50 |
| CloudWatch Dashboard | 1 dashboard (free tier) | $0.00 | $0.00 |
| Step Functions Express (100 destinos) | 100 requests + 32 GB-s | $0.000633 | $0.00 |
| Step Functions Standard (100 destinos) | 300 state transitions | 300 × $0.0000375 | $0.01 |
| Bedrock Claude 3 Haiku (100 destinos) | 9,000 input + 20,000 output tokens | $0.00225 + $0.025 | $0.027 |
| SNS (100 emails) | dentro del free tier | $0.00 | $0.00 |
| S3 prompts | dentro del free tier | $0.00 | $0.00 |
| Lambda — notificationFunction + postConfirmationFunction (x2) | ~1,000,000 invocaciones + duración | ~$0.20 + $1.07 | $1.27 |
| SQS notificationQueue + DLQ | ~1,000,000 mensajes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| SNS booking notifications | ~1,000,000 publishes (dentro del free tier 1M/mes) | $0.00 | $0.00 |
| S3 media bucket — Storage | ~10 GB imágenes | 5GB free + 5GB × $0.023 | $0.12 |
| S3 media bucket — GET Requests | ~100,000 requests (10% llegan a S3, resto sirve CloudFront caché) | 100,000 × $0.005/1,000 | $0.50 |
| CloudFront — HTTPS Requests | ~1,000,000 requests (dentro del free tier 10M/mes) | $0.00 | $0.00 |
| CloudFront — Data Transfer | ~20 GB (dentro del free tier 1TB/mes) | $0.00 | $0.00 |
| Cognito Identity Pool | gratuito | $0.00 | $0.00 |
| Secrets Manager | 2 secrets (fijo) | 2 × $0.40 | $0.80 |
| **TOTAL TRÁFICO ALTO** | | | **~$17.09/mes** |

---

## Resumen de Costos Totales

| Nivel de Tráfico | Usuarios/mes | Requests/mes | Destinos nuevos/mes | Costo Total/mes |
|-----------------|-------------|-------------|--------------------|-----------------| 
| Bajo | ~5,000 | ~50,000 | 10 | **~$2.28** |
| Medio | ~25,000 | ~250,000 | 50 | **~$5.38** |
| Alto | ~100,000 | ~1,000,000 | 100 | **~$17.09** |

> CloudFront con CachePolicy.CACHING_OPTIMIZED absorbe ~90% de las requests de imágenes — solo el 10% llega a S3 como origin request.
> SQS, CloudFront data transfer y SNS booking están dentro del free tier permanente en todos los escenarios.
> Cognito Identity Pool no tiene costo adicional sobre el User Pool.
> Secrets Manager ($0.80/mes fijo) es el segundo costo más grande en tráfico bajo, representando el 35% del total.

---

## Proyección de Crecimiento (desde tráfico bajo)

| Patrón | Mes 1 | Mes 3 | Mes 6 | Mes 12 |
|--------|-------|-------|-------|--------|
| Estable (sin crecimiento) | $2.28 | $2.28 | $2.28 | $2.28 |
| Moderado (5%/mes) | $2.28 | $2.64 | $3.06 | $4.08 |
| Rápido (10%/mes) | $2.28 | $3.03 | $3.67 | $5.83 |

---

## Recomendaciones

### Optimización de costos
- API Gateway REST en sa-east-1 cuesta $4.25/millón — migrar a **HTTP API** reduciría ese costo a ~$0.10/millón (97% de ahorro). Es el cambio de mayor impacto.
- DynamoDB en sa-east-1 es un 50% más caro que en us-east-1 ($0.9375 vs $0.625 por millón de WRU), aunque con este volumen el impacto es mínimo.

### Sobre Step Functions y Bedrock
- Step Functions tiene **4,000 state transitions gratuitas/mes** (free tier permanente) — con 10-50 destinos/mes estás muy por debajo del límite.
- El prompt real de Bedrock tiene ~90 tokens de input — mantenerlo corto es la mejor optimización de costo.
- SNS email está dentro del free tier permanente (1M publishes/mes gratuitos).

### Sobre Bedrock
- Claude 3 Haiku disponible en sa-east-1 bajo "Geo and In-region Cross-region Inference".
- Precio confirmado en AWS Pricing: $0.25/$1.25 por 1M tokens input/output.
- Para mayor calidad en los emails generados se puede migrar a Claude Haiku 4.5 ($1.00/$5.00 por 1M tokens) — 4x más caro pero sigue siendo centavos a este volumen.
