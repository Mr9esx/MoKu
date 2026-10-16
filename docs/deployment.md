# 生产部署

- 域名：<https://moku.miaoplus.com>
- 服务器：`118.196.126.221`，SSH 端口 `22022`
- 应用：Vite 静态输出，由系统 Nginx 托管，无 Node 常驻服务或数据库。
- 发布目录：`/var/www/moku/releases/<UTC时间>-<提交短哈希>`，`/var/www/moku/current` 指向当前版本。
- 站点配置：仓库 `deploy/nginx.conf`，服务器 `/etc/nginx/sites-available/moku.miaoplus.com.conf`。
- TLS：Certbot webroot，挑战目录 `/var/www/certbot`；`certbot.timer` 自动续期，deploy hook 重新加载 Nginx。

## 更新

在 `main` 上运行 `pnpm install --frozen-lockfile`、`pnpm exec vitest run --maxWorkers=1 --minWorkers=1`、`pnpm build`。资源预算测试包含大图纸，限制并发避免 CPU 竞争触发测试超时。

将完整 `dist/` 上传至新的发布目录，保留现有版本；可在输出中加入 `version.json` 记录 Git 提交和构建时间。切换前将当前版本的 `assets/` 合并到新版本的 `assets/`，只补充缺失的文件，保留旧哈希资源，避免已打开的页面无法加载旧版懒加载模块或 Worker。macOS 打包时使用 `COPYFILE_DISABLE=1 tar ...`，避免附带 AppleDouble 文件。首次上线先只启用 HTTP 站点，使用以下命令签发证书，再启用完整配置：

```sh
certbot certonly --webroot -w /var/www/certbot -d moku.miaoplus.com --non-interactive --agree-tos
```

在 `/var/www/moku/` 下创建指向新发布目录的 `current.next` 软链接，再用 `mv -Tf current.next current` 原子切换。配置修改须先 `nginx -t`，通过后 `systemctl reload nginx`。HTML 使用 `no-cache`，带内容哈希的 `/assets/` 文件使用一年不可变缓存。

上线后确认 HTTP 跳转 HTTPS、TLS 域名校验、首页、JS/CSS/Worker 和示例 DXF 请求成功；在浏览器检查示例导入和 3D 组装。

## 回滚

保留历史发布目录。回滚前把当前 `assets/` 中缺失的哈希资源补充到目标发布目录，兼容仍打开的页面。将 `current.next` 指向上一发布目录，再执行 `mv -Tf /var/www/moku/current.next /var/www/moku/current`，随后核对首页和 `version.json`。回滚静态文件无需重启 Nginx。发布目录中仅存构建产物，不存密码或私钥。
