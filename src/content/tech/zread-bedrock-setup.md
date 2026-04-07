---
title: 用 AWS Bedrock + LiteLLM 驱动 zread 生成代码文档
date: 2026-04-08
description: zread 只支持 OpenAI 兼容接口，本文记录如何通过 LiteLLM Proxy 将请求转发到 AWS Bedrock 上的 Claude 模型，并在 cookllm-recipes 项目上验证成功。
tags: [AWS, Bedrock, LLM, zread, LiteLLM]
---

[zread](https://zread.ai) 是一款命令行工具，可以读取源代码并自动生成 Wiki 文档。它本身只支持 OpenAI 兼容格式的 LLM 接口（配置文件在 `~/.zread/config.yaml`）。

目标：让 zread 使用 AWS Bedrock 上的 Claude 模型（claude-sonnet-4-6），而不是 OpenAI。已在 [cookllm-recipes](https://github.com/zhangzhenyubj/cookllm-recipes) 项目上验证成功。

---

## 环境信息

- 系统：macOS (darwin-arm64)
- AWS 凭证：`~/.aws/credentials` 中的 `default` profile
- AWS Region：`us-west-2`
- Bedrock Inference Profile ARN（Sonnet）：`arn:aws:bedrock:us-west-2:<your_account_id>:application-inference-profile/<profile_id>`
- 网络代理：`http://<your_proxy_host>:8118`（访问 AWS 需要）
- zread 版本：npm 全局安装，底层是 Go 预编译二进制（`/opt/homebrew/lib/node_modules/zread_cli`）

---

## 问题分析

zread 的 `~/.zread/config.yaml` 默认配置：

```yaml
llm:
    provider: openai
    model: gpt-4
    api_key: ""
    base_url: https://api.openai.com/v1
```

zread 不原生支持 Bedrock，也不支持 AWS 认证。需要在中间加一层代理，将 OpenAI 格式请求转发到 Bedrock。

**选择方案：LiteLLM Proxy**

LiteLLM 是一个开源的 LLM 网关，支持：
- 暴露 OpenAI 兼容的 `/v1/chat/completions` 接口
- 后端转发到 100+ 个 LLM provider，包括 AWS Bedrock

---

## 实施步骤

### 1. 创建独立 conda 环境并安装 LiteLLM

```bash
conda create -n litellm python=3.11 -y
conda run -n litellm pip install 'litellm[proxy]'
```

安装成功，litellm 版本 1.83.4。

### 2. 验证 AWS 凭证可以直接调用 Bedrock

在配置 LiteLLM 之前，先用 AWS CLI 验证凭证有效：

```bash
AWS_ACCESS_KEY_ID=<key> \
AWS_SECRET_ACCESS_KEY=<secret> \
AWS_REGION=us-west-2 \
HTTPS_PROXY=http://<your_proxy_host>:8118 \
aws bedrock-runtime invoke-model \
  --model-id "arn:aws:bedrock:us-west-2:<your_account_id>:application-inference-profile/<profile_id>" \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/bedrock-out.json
```

**结果：成功**，返回 `claude-sonnet-4-6` 的响应。

### 3. 创建 LiteLLM 配置文件

路径：`/tmp/litellm_config.yaml`

**踩坑 1：** 第一版把 `http_proxy` 写进了 `litellm_params`：

```yaml
# 错误写法 - LiteLLM 会把 http_proxy 字段传入请求体，Bedrock 报错
litellm_params:
  model: bedrock/...
  http_proxy: http://<your_proxy_host>:8118   # ❌ 不要放这里
```

Bedrock 返回错误：`"http_proxy: Extra inputs are not permitted"`

**踩坑 2：** 使用 `bedrock/` 前缀调用 inference profile ARN：

```bash
# 报错：Unknown provider=None
model: bedrock/arn:aws:bedrock:us-west-2:<your_account_id>:application-inference-profile/<profile_id>  # ❌
```

**正确写法：** inference profile ARN 必须用 `bedrock/converse/` 路由：

```yaml
model: bedrock/converse/arn:aws:bedrock:us-west-2:<your_account_id>:application-inference-profile/<profile_id>  # ✅
```

**踩坑 3：** 废弃模型

最初尝试使用 `anthropic.claude-3-5-sonnet-20241022-v2:0`，Bedrock 返回：
> "This model version has reached the end of its life."

解决：改用 inference profile ARN（对应 claude-sonnet-4-6）。

**最终有效配置：**

```yaml
# /tmp/litellm_config.yaml
model_list:
  - model_name: claude-sonnet
    litellm_params:
      model: bedrock/converse/arn:aws:bedrock:us-west-2:<your_account_id>:application-inference-profile/<profile_id>
      aws_access_key_id: <your_key>
      aws_secret_access_key: <your_secret>
      aws_region_name: us-west-2
      # 注意：不要在这里写 http_proxy/https_proxy！
```

网络代理通过环境变量传递：

```bash
HTTPS_PROXY=http://<your_proxy_host>:8118 \
HTTP_PROXY=http://<your_proxy_host>:8118 \
conda run -n litellm --no-capture-output \
  env HTTPS_PROXY=... HTTP_PROXY=... \
  litellm --config /tmp/litellm_config.yaml --port 4000
```

### 4. 验证 LiteLLM proxy 工作正常

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy" \
  -d '{"model":"claude-sonnet","messages":[{"role":"user","content":"hi"}],"max_tokens":20}'
```

**返回成功**：
```json
{
  "model": "claude-sonnet",
  "choices": [{
    "message": {
      "content": "Hi there! How are you doing? Is there something I can help you with today?",
      "role": "assistant"
    }
  }]
}
```

### 5. 配置 zread 指向 LiteLLM proxy

修改 `~/.zread/config.yaml`：

```yaml
language: zh
doc_language: zh
llm:
    provider: openai
    model: claude-sonnet       # LiteLLM 中定义的 model_name
    api_key: "dummy"           # LiteLLM 默认不校验 key，随便填
    base_url: http://localhost:4000/v1
concurrency:
    max_concurrent: 1
    max_retries: 0
```

---

## 已验证可用的完整流程

```bash
# 1. 后台启动 LiteLLM proxy（每次开机需要）
HTTPS_PROXY=http://<your_proxy_host>:8118 \
HTTP_PROXY=http://<your_proxy_host>:8118 \
conda run -n litellm --no-capture-output \
  env HTTPS_PROXY=http://proxy-aws-us.zhenguanyu.com:8118 \
      HTTP_PROXY=http://proxy-aws-us.zhenguanyu.com:8118 \
  litellm --config /tmp/litellm_config.yaml --port 4000 &

# 2. 等待启动
sleep 6

# 3. 在目标项目目录运行 zread
cd /path/to/your/project
zread generate -y
```

在 cookllm-recipes 项目上已完整跑通，生成了 `.zread/wiki/` 下的文档。

---

## 关键排查经验总结

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `http_proxy: Extra inputs are not permitted` | proxy 字段写进了 litellm_params | 改用环境变量传递代理 |
| `Unknown provider=None` | inference profile ARN 用了 `bedrock/` 前缀 | 改用 `bedrock/converse/` 前缀 |
| `end of its life` | 使用了废弃的 claude-3-5-sonnet 模型 | 改用 inference profile ARN（对应 claude-sonnet-4-6）|
| LiteLLM 不读环境变量 | `conda run` 不继承父 shell 环境 | 通过 `env KEY=VAL` 显式传递 |

---

## 依赖版本

- litellm: 1.83.4
- Python: 3.11 (conda env: litellm)
- zread_cli: npm global install
- AWS CLI: default profile，region us-west-2
