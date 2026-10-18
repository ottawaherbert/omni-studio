# 本地 Qwen3-TTS

在 Apple Silicon Mac 的项目根目录运行：

```sh
sh apps/local-tts/install.sh
sh apps/local-tts/start.sh
sh apps/local-tts/status.sh
sh apps/local-tts/restart.sh
sh apps/local-tts/stop.sh
```

安装需要 `uv` 和联网，重复安装会复用 Python 3.12 虚拟环境和模型缓存，不删除旧模型。默认模型是 `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`，固定提交 `41d3337e8b7f2843a75841595fc14e4b9a7a4b96`，下载约 3.08 GB。依赖版本位于 `requirements.lock.txt`。

其他模型必须同时指定完整提交 SHA：

```sh
sh apps/local-tts/install.sh \
  --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit \
  --revision 049ef77fe8816b536193c0c25f9a214d17921282
```

安装将该模型的本地默认缓存引用固定到所选 SHA，并记录 `.local-tts/installed-model.json`。启动的服务处于 Hugging Face 离线模式，只能使用已经安装并缓存的模型，不会按请求偷偷下载新权重。后续安装其他模型后需在系统设置中选择对应模型 ID。

`start.sh` 在后台启动并检查接口就绪；重复启动不会创建第二个服务。服务监听 `http://127.0.0.1:8033`，系统渠道基础地址使用 `http://127.0.0.1:8033/v1`，不需要 API Key。日志追加到 `.local-tts/server.log`。这是当前用户的后台进程，不是开机启动服务；Mac 重启后运行 `start.sh`。

启停脚本记录 PID、启动时间和完整命令，遇到未知进程占用端口或 PID 被复用会拒绝发送信号。旧版前台启动的服务可先用 `lsof -nP -iTCP:8033 -sTCP:LISTEN` 与 `ps -p PID -o command=` 核对，再执行 `.local-tts/venv/bin/python apps/local-tts/service.py adopt PID`。接管命令还会验证工作目录和可执行路径。停止使用 SIGTERM，30 秒未退出会保留进程并报告，不会强制杀死合成中的任务。

模型能力：

- 1.7B CustomVoice 支持 9 个固定音色及自然语言表演指令；接口字段为 `voice`、`lang_code`、`instruct`。
- 官方推理实现会清空 0.6B 的 `instruct`。MLX 0.5.3 虽可能将指令传入 CustomVoice，但这不代表模型受训支持该能力；0.6B 不能用于验证表演指令。
- MLX 0.5.3 的 Qwen3-TTS 没有实现数值语速与音高控制。使用默认 `speed: 1`；可用自然语言指令描述节奏，但不等同于精确倍速。
- CustomVoice 使用预置音色，不是任意参考音频克隆模型。声音的实际表演效果仍需要试听验收。

固定版本来源：[MLX 模型仓库](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit/tree/41d3337e8b7f2843a75841595fc14e4b9a7a4b96)、[Qwen 官方推理实现](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)。
