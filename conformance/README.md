# conformance —— 信封与版本协商一致性用例集

本目录是 **0.4 协议的跨语言一致性用例**：每条用例给一个输入（线间信封，或存储侧消息）和期望结果（接受 / 错误码）。
用例是纯 JSON，不依赖 Node、不依赖本仓库代码，任何语言的实现都可以读同一批文件跑同一批断言。

- 机器可读定义：[`schema/envelope.v0_4.json`](../schema/envelope.v0_4.json)、[`schema/message.v0_4.json`](../schema/message.v0_4.json)
- 协议正文：[docs/PROTOCOL.md](../docs/PROTOCOL.md)（信封、版本协商、状态机、错误码）
- 本仓库参考 runner：[`test/conformance.test.js`](../test/conformance.test.js)（自写 ~70 行最小校验器，无外部依赖）

## 1. 判定模型

一条用例回答一个问题：**给定这个输入，实现应当接受还是拒绝？**

```
输入信封（wire）            + 期望：接受 -> 继续走状态机 queued -> claimed -> delivered -> acked
或 存储消息（含 state 初始状态）  + 期望：错误码 -> 拒绝，且按该错误码决定落点
```

- `ok: true`：接受。wire 信封可以入队；存储消息保持自己的 `state` 继续推进。
- `errorCode`：拒绝。错误码分三层：

| 错误码 | 层 | 落点 |
|---|---|---|
| `SCHEMA_INVALID` | conformance 层（仅本目录使用，不是 `LINE_*` 传输错误） | 结构/必填/正则/枚举不合法 -> 拒绝入队，不产生消息行 |
| `LINE_INVALID_AGENT` / `LINE_INVALID_LINE` | `lib/protocol.js` `validateAgentId` / `validateLineLabel` | 地址非法 -> 拒绝入队 |
| `LINE_PROTOCOL_MISMATCH` | `lib/protocol.js` `assertProtocolCompatible` | `major` 不兼容 -> **不投递**，存储侧落 `failed` + `last_error=LINE_PROTOCOL_MISMATCH...`，可 `line_trace` / `line_redeliver` / `line_purge` 处置 |

- 存储侧用例的**初始状态**就是 `input.state`（`queued`/`claimed`/`delivered`/`acked`/`failed`/`expired`/`pending_approval`）。
- 版本兼容规则（[docs/PROTOCOL.md](../docs/PROTOCOL.md) §版本协商）：
  - 缺 `protocolVersion`/`protocol_version` -> 视为 `0.3`（旧消息兼容）；
  - `major` 相同 -> 接受，`minor` 更高意味着**忽略未知字段**而不是拒绝；
  - `major` 不同 -> `LINE_PROTOCOL_MISMATCH`。

## 2. 用例格式

每个 `conformance/cases/*.json` 是一个对象：

```json
{
  "suite": "a-valid",
  "description": "人读说明；可选",
  "cases": [
    {
      "name": "a/valid-full-envelope",
      "note": "人读说明；可选",
      "check": "schema",
      "schema": "envelope.v0_4",
      "input": { "id": "msg_...", "protocolVersion": "0.4", "from": { "...": "..." } },
      "expect": { "ok": true }
    }
  ]
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `name` | 是 | 用例名，**全局唯一**；runner 用它命名测试 |
| `input` | 是 | 待判定对象（信封或存储消息） |
| `expect` | 是 | `{"ok": true}`、`{"ok": true, "protocolVersion": "0.5"}` 或 `{"ok": false, "errorCode": "..."}` |
| `check` | 否 | 判定类型，默认 `schema`：`schema` \| `address` \| `protocolVersion` |
| `schema` | 否 | `check=schema` 时用哪个 schema，文件名去掉 `.json`，默认 `envelope.v0_4` |
| `note` | 否 | 人读说明 |

`expect.protocolVersion` 是可选的附加断言：**版本解析结果**（缺省解析为 `0.3`）。它同时验证"旧消息无版本 -> 0.3"这条兼容规则。

三类 `check` 的判定：

| `check` | 判定方式 |
|---|---|
| `schema` | 用 draft 2020-12 校验器按 `schema/<name>.json` 校验 `input`；无错误 -> 接受 |
| `address` | 用 `^[a-z0-9][a-z0-9._-]{0,95}$` 校验 `input.from.agentId` / `input.to.agentId`，用 `^[a-z0-9][a-z0-9._-]{0,63}$` 校验对应 `line` |
| `protocolVersion` | 取 `input.protocol_version`（存储侧列）或 `input.protocolVersion`（wire 字段），都没有 = `0.3`；与本实现 `0.4` 比 `major` |

## 3. 用任意语言跑（与语言无关）

对每个 `cases/*.json` 里的每条用例，按 `check` 执行三步中的一步，然后断言 `expect`：

1. **`check = "schema"`**：用标准 JSON Schema 校验器加载 `schema/<schema>.json`，校验 `input`。
   任何 draft 2020-12 实现都行：
   - JS：`ajv`（`new Ajv2020({strict: false})`，或 `ajv/dist/2020`）
   - Python：`jsonschema.Draft202012Validator(schema)`
   - Go：`github.com/santhosh-tekuri/jsonschema/v6`
   - Ruby：`json-schema`（draft-2020-12 支持版本）
   校验器必须**遵守** `additionalProperties: true`（不要强制额外字段为 false，否则 0.5 用例会假失败）。
2. **`check = "address"`**：用上面两条正则校验 4 个地址字段（`from.agentId`、`from.line`、`to.agentId`、`to.line`），首个不合法者决定错误码。
3. **`check = "protocolVersion"`**：解析版本，`major` 与本实现不同 -> `LINE_PROTOCOL_MISMATCH`，否则接受。

最小 Python 骨架：

```python
import json, pathlib
from jsonschema import Draft202012Validator

root = pathlib.Path("conformance")
schemas = {p.stem: json.loads(p.read_text()) for p in (root.parent / "schema").glob("*.json")}
AGENT, LINE = r"^[a-z0-9][a-z0-9._-]{0,95}$", r"^[a-z0-9][a-z0-9._-]{0,63}$"

def version_of(case):
    v = case["input"].get("protocolVersion", case["input"].get("protocol_version", ""))
    return v.strip() or "0.3"

for path in sorted(root.glob("cases/*.json")):
    for case in json.loads(path.read_text())["cases"]:
        check = case.get("check", "schema")
        errors = []
        if check == "schema":
            errors = list(Draft202012Validator(schemas[case.get("schema", "envelope.v0_4")]).iter_errors(case["input"]))
        elif check == "address":
            for v, rx in ((case["input"]["from"]["agentId"], AGENT), (case["input"]["from"]["line"], LINE),
                          (case["input"]["to"]["agentId"], AGENT), (case["input"]["to"]["line"], LINE)):
                if not __import__("re").match(rx, v):
                    errors.append("bad address: " + v)
        else:
            if version_of(case).split(".")[0] != "0":
                errors.append("LINE_PROTOCOL_MISMATCH")
        expect = case["expect"]
        ok = not errors
        assert ok == expect["ok"], (case["name"], errors)
        if not ok:
            assert expect["errorCode"] in ("SCHEMA_INVALID", "LINE_INVALID_AGENT", "LINE_INVALID_LINE", "LINE_PROTOCOL_MISMATCH")
print("conformance ok")
```

> 版本规则只比 `major`：本实现是 `0.4`，所以 `0.3`/`0.5`/`0.12` 都兼容，`1.0`/`2.7` 不兼容。
> 上面的骨架把 `address` 的错误码简化成统一字符串；严格实现应像 `lib/protocol.js` 一样区分 `LINE_INVALID_AGENT` 与 `LINE_INVALID_LINE`（本仓库 runner 就是这么断言的）。

## 4. 用例覆盖（7 组 / 25 条）

| 文件 | 类别 | 用例数 |
|---|---|---|
| `cases/a-valid-envelope.json` | 合法信封 / 合法存储消息通过 | 3 |
| `cases/b-missing-required.json` | 缺必填字段被拒 | 5 |
| `cases/c-invalid-address.json` | 非法 agentId / line 被拒（address + schema 两层） | 5 |
| `cases/d-major-mismatch.json` | major 不同 -> `LINE_PROTOCOL_MISMATCH` | 3 |
| `cases/e-minor-newer-unknown-fields.json` | minor 更高 + 未知字段 -> 接受并忽略 | 3 |
| `cases/f-legacy-without-version.json` | 旧消息无 `protocolVersion` -> 视为 `0.3` | 3 |
| `cases/g-invalid-types.json` | 非法类型/枚举（id/kind/body.text）被 schema 拒绝 | 3 |

## 5. 新增用例

1. 在对应类别文件（或新建 `cases/g-*.json`）里追加一条，`name` 用 `<类别>/<短横线描述>`，保证全局唯一。
2. 只写 `input` + `expect`，让 runner 推导其余行为；`note` 写清楚"为什么"。
3. 在仓库里跑：

```bash
node --test test/conformance.test.js
```

4. 若改了信封字段或版本规则，先改 `schema/*.json`，再让用例保持可跑——用例是契约，不要在 runner 里为通过用例开后门。
