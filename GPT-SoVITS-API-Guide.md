# GPT-SoVITS API 调用指南 & 已知 Bug 汇总

> 基于官方仓库 RVC-Boss/GPT-SoVITS main 分支源码整理，截至 2026-05-14

---

## 一、两套 API 概览

GPT-SoVITS 提供两套 API 服务：

| 特性 | `api.py` (V1) | `api_v2.py` (V2) |
|------|---------------|-------------------|
| 启动方式 | `python api.py` | `python api_v2.py -c GPT_SoVITS/configs/tts_infer.yaml` |
| 推理端点 | `/` | `/tts` |
| 配置方式 | 命令行参数指定模型/参考音频 | YAML 配置文件 |
| 流式支持 | close/normal/keepalive 三种模式 | streaming_mode 0/1/2/3 四档 |
| 模型热切换 | `/set_gpt_weights` + `/set_sovits_weights`（POST） | `/set_gpt_weights` + `/set_sovits_weights`（GET） |
| 参考音频 | 支持默认 + 手动指定 + 多参考(inp_refs) | 支持默认 + 手动指定 + 辅助参考(aux_ref_audio_paths) |
| V3/V4 支持 | ✅ | ✅（更完善） |
| 推荐 | 新项目推荐用 V2 | **推荐使用** |

---

## 二、api_v2.py 完整用法

### 2.1 启动参数

```bash
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-a` | `127.0.0.1` | 绑定地址，传 `-a None` 可监听双栈 |
| `-p` | `9880` | 绑定端口 |
| `-c` | `GPT_SoVITS/configs/tts_infer.yaml` | TTS 配置文件路径 |

### 2.2 推理端点 `/tts`

**GET 示例：**
```
http://127.0.0.1:9880/tts?text=你好世界&text_lang=zh&ref_audio_path=ref.wav&prompt_lang=zh&prompt_text=参考文本&text_split_method=cut5&batch_size=1&media_type=wav&streaming_mode=true
```

**POST 请求体（完整参数）：**
```json
{
    "text": "",                    // [必填] 要合成的文本
    "text_lang": "",               // [必填] 文本语言: zh/en/ja/ko/yue/all_zh/all_ja/all_ko/all_yue/auto/auto_yue
    "ref_audio_path": "",          // [必填] 参考音频路径
    "aux_ref_audio_paths": [],     // [可选] 辅助参考音频路径列表（多说话人音色融合）
    "prompt_text": "",             // [可选] 参考音频对应文本
    "prompt_lang": "",             // [必填] 参考音频语言
    "top_k": 15,                   // top-k 采样
    "top_p": 1,                    // top-p 采样
    "temperature": 1,              // 温度系数
    "text_split_method": "cut5",   // 文本切分方法
    "batch_size": 1,               // 推理 batch size
    "batch_threshold": 0.75,       // batch 分割阈值
    "split_bucket": true,          // 是否按桶分割 batch
    "speed_factor": 1.0,           // 语速控制（1.0=正常）
    "fragment_interval": 0.3,      // 音频片段间隔
    "seed": -1,                    // 随机种子（-1=随机）
    "media_type": "wav",           // 输出格式: wav/raw/ogg/aac
    "streaming_mode": false,       // 流式模式：0/1/2/3 或 true/false
    "parallel_infer": true,        // 是否并行推理
    "repetition_penalty": 1.35,    // 重复惩罚（T2S 模型）
    "sample_steps": 32,            // V3/VITS 模型采样步数
    "super_sampling": false,       // V3 超分辨率
    "overlap_length": 2,           // 流式模式语义 token 重叠长度
    "min_chunk_length": 16         // 流式模式最小 chunk 长度
}
```

**streaming_mode 详解：**

| 值 | 含义 |
|----|------|
| `0` / `false` | 非流式，一次返回完整音频 |
| `1` / `true` | 最佳质量，响应最慢（旧版流式） |
| `2` | 中等质量，响应较慢 |
| `3` | 较低质量，响应最快 |

**返回：**
- 成功：直接返回音频流，HTTP 200
- 失败：返回 JSON 错误信息，HTTP 400

### 2.3 控制端点 `/control`

```
GET http://127.0.0.1:9880/control?command=restart
GET http://127.0.0.1:9880/control?command=exit
```

### 2.4 切换 GPT 模型 `/set_gpt_weights`

```
GET http://127.0.0.1:9880/set_gpt_weights?weights_path=GPT_weights/你的模型.ckpt
```

### 2.5 切换 SoVITS 模型 `/set_sovits_weights`

```
GET http://127.0.0.1:9880/set_sovits_weights?weights_path=SoVITS_weights/你的模型.pth
```

### 2.6 设置参考音频 `/set_refer_audio`

```
GET http://127.0.0.1:9880/set_refer_audio?refer_audio_path=ref.wav
```

---

## 三、api.py (V1) 用法

### 3.1 启动参数

```bash
python api.py -s SoVITS_weights/model.pth -g GPT_weights/model.ckpt -dr ref.wav -dt "参考文本" -dl zh -d cuda -a 127.0.0.1 -p 9880
```

| 参数 | 说明 |
|------|------|
| `-s` | SoVITS 模型路径（可在 config.py 中指定） |
| `-g` | GPT 模型路径（可在 config.py 中指定） |
| `-dr` | 默认参考音频路径 |
| `-dt` | 默认参考音频文本 |
| `-dl` | 默认参考音频语种: zh/en/ja/ko/yue |
| `-d` | 推理设备: cuda/cpu |
| `-a` | 绑定地址，默认 127.0.0.1 |
| `-p` | 绑定端口，默认 9880 |
| `-fp` | 全精度推理 |
| `-hp` | 半精度推理 |
| `-sm` | 流式模式: close(c)/normal(n)/keepalive(k) |
| `-mt` | 音频格式: wav/ogg/aac |
| `-st` | 音频数据类型: int16/int32 |
| `-cp` | 文本切分符号，如 `",.，。"` |
| `-hb` | cnhubert 路径 |
| `-b` | bert 路径 |

### 3.2 推理端点 `/`

**GET（使用默认参考音频）：**
```
http://127.0.0.1:9880?text=你好世界&text_language=zh
```

**POST（使用默认参考音频）：**
```json
{
    "text": "你好世界",
    "text_language": "zh"
}
```

**POST（手动指定参考音频）：**
```json
{
    "refer_wav_path": "ref.wav",
    "prompt_text": "参考文本",
    "prompt_language": "zh",
    "text": "你好世界",
    "text_language": "zh",
    "top_k": 20,
    "top_p": 0.6,
    "temperature": 0.6,
    "speed": 1,
    "inp_refs": ["ref2.wav", "ref3.wav"]
}
```

### 3.3 其他端点

- `/change_refer` — 更换默认参考音频
- `/control?command=restart` — 重启
- `/control?command=exit` — 退出

---

## 四、text_split_method 切分方法

api_v2.py 支持的切分方法（定义在 `GPT_SoVITS/TTS_infer_pack/text_segmentation_method.py`）：

| 方法 | 说明 |
|------|------|
| `cut5` | 默认，按标点切分 |
| `cut0` | 不切分，整段合成 |
| 其他 | 参见源码中的 get_method_names() |

---

## 五、已知 Bug 与坑

### 🔴 Bug 1：生成语音时长异常（过长/重复循环）

**现象：** 生成的音频时长远超预期，出现重复、拖尾、无限循环。

**根因分析：**

1. **GPT 模型的 `max_sec` 限制失效**
   - 源码中 `early_stop_num = hz * max_sec`（`hz=50`）作为 T2S 模型的早停阈值
   - 如果 GPT 训练时 `max_sec` 设置不当（如训练数据中存在超长片段），推理时模型可能生成超出预期的语义 token
   - `repetition_penalty` 默认 1.35，如果设太低，模型容易陷入重复循环

2. **文本过长 + 切分不当**
   - 如果传入很长的文本且 `text_split_method` 不是 `cut5`，模型一次性尝试生成整段音频，容易崩
   - **解决：** 使用 `cut5` 切分，或手动将长文本按句拆分

3. **温度过高导致发散**
   - `temperature` 设得太高（如 > 1.2），模型采样空间扩大，可能生成无意义重复
   - **解决：** temperature 控制在 0.6~1.0 之间

4. **参考音频与目标文本语言不匹配**
   - 参考音频是中文，目标文本是英文混合时，可能导致韵律异常
   - **解决：** 使用 `all_zh`/`auto` 等混合语言模式，或确保参考音频语言与目标语言一致

**修复建议：**

```python
# 在调用时设置安全参数
{
    "temperature": 0.8,           # 不要太高
    "repetition_penalty": 1.35,   # 不要太低
    "top_k": 15,
    "top_p": 1.0,
    "text_split_method": "cut5",  # 强制切分
    "speed_factor": 1.0
}
```

### 🔴 Bug 2：模型文件加载异常

**现象：** 切换模型时报错 `change gpt weight failed` / `change sovits weight failed`

**常见原因与解决方案：**

| 问题 | 原因 | 解决 |
|------|------|------|
| 路径含中文/空格 | Python/PyTorch 无法识别 | 移到纯英文无空格路径 |
| GPT 模型 ckpt 损坏 | 下载不完整或中断 | 重新下载，用 `torch.load()` 验证 |
| SoVITS 模型版本不匹配 | v2 模型用 v3 底模加载 | 确认模型版本与底模一致 |
| LoRA 底模缺失 | v3/v4 LoRA 需要对应底模 | 下载预训练底模到 `pretrained_models/` |
| OSError: Unable to load weights | 权重文件损坏 | `torch.load(path)` 测试，损坏则重新下载 |
| DDP 并行训练保存的权重 | 多卡写入同一文件导致损坏 | 仅 rank 0 保存权重 |

**验证模型文件脚本：**
```python
import torch
# 验证 GPT 模型
try:
    d = torch.load("GPT_weights/your_model.ckpt", map_location="cpu", weights_only=False)
    print("GPT 模型加载成功, keys:", list(d.keys()))
except Exception as e:
    print(f"GPT 模型损坏: {e}")

# 验证 SoVITS 模型
try:
    d = torch.load("SoVITS_weights/your_model.pth", map_location="cpu", weights_only=False)
    print("SoVITS 模型加载成功, keys:", list(d.keys()))
except Exception as e:
    print(f"SoVITS 模型损坏: {e}")
```

### 🔴 Bug 3：OGG 格式输出 Stack Overflow

**现象：** 长音频以 OGG 格式输出时，`libsndfile` 的 `sf_writef_short` 触发栈溢出。

**根因：** `libsndfile_64bit.dll` 的已知 bug，大音频张量（约 50 万帧）写入 OGG 时触发。

**官方 workaround（已在源码中实现）：** 单独线程 + 增大线程栈大小（`stack_size = 4096 * 4096`）。

**关联 Issue：**
- https://github.com/RVC-Boss/GPT-SoVITS/issues/1199
- https://github.com/libsndfile/libsndfile/issues/1023
- https://github.com/bastibe/python-soundfile/issues/396

**如果仍然溢出：** 修改 `stack_size` 的倍数，或改用 WAV 格式输出。

### 🟡 Bug 4：纯符号文本导致参考音频泄露

**现象：** 传入只有标点符号的文本时，生成的音频可能出现参考音频的内容泄露。

**源码处理：** `if only_punc(text): continue` — 纯符号文本会被跳过，但如果你的文本清理不彻底可能绕过此检查。

**解决：** 调用前先过滤掉纯符号/空文本。

### 🟡 Bug 5：短文本（phone < 6）处理异常

**现象：** 极短文本（少于 6 个音素）可能导致韵律异常。

**源码处理：** 当 `len(phones) < 6` 时，自动在文本前加 `.` 重新处理：
```python
if not final and len(phones) < 6:
    return get_phones_and_bert("." + text, language, version, final=True)
```

**影响：** 短文本可能被加前缀，生成结果与预期略有差异。

### 🟡 Bug 6：V3/V4 模型 sample_steps 范围限制

- **V3：** 只接受 `[4, 8, 16, 32, 64, 128]`，其他值自动回退到 32
- **V4：** 只接受 `[4, 8, 16, 32]`，其他值自动回退到 8

超出范围的值**不会报错**，而是静默回退，可能让你以为参数生效了。

---

## 六、最佳实践

1. **推荐使用 `api_v2.py`**，功能更完善、参数更规范
2. **文本切分用 `cut5`**，避免超长文本一次性推理
3. **temperature 控制在 0.6~1.0**，repetition_penalty 不低于 1.35
4. **路径不含中文/空格/特殊字符**
5. **参考音频 3~10 秒**，清晰、低噪声、采样率 16kHz/32kHz
6. **长文本拆分后批量调用**，而非一次传入整篇文章
7. **模型切换后验证**：切换权重后先发一条短文本测试
8. **输出格式优先 WAV**，OGG 可能栈溢出，AAC 依赖 ffmpeg
9. **训练数据音频至少 60 秒**，片段 8~15 秒，信噪比 > 20dB
10. **seed 固定**：需要可复现结果时设置固定 seed

---

*参考来源：RVC-Boss/GPT-SoVITS 官方仓库 api.py + api_v2.py 源码、GitHub Issues*
