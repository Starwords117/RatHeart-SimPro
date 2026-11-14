#!/usr/bin/env bash
# ============================================================
# GitHub Release v0.1.1 一键创建与上传
# 前置:一个对 RatHeart-SimPro 有 Contents: Read and write 权限的
#      fine-grained PAT(仅存于环境变量,不落盘)
# 用法:GH_TOKEN=<token> bash scripts/upload-release.sh
# 依赖:curl、python3;重复运行安全(同名同大小资产自动跳过)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="Starwords117/RatHeart-SimPro"
TAG="v0.1.1"
: "${GH_TOKEN:?请以 GH_TOKEN=<fine-grained PAT> 运行}"

API="https://api.github.com/repos/${REPO}"
UPLOAD="https://uploads.github.com/repos/${REPO}/releases"
ASSETS=(
  release/RatHeart-SimPro-0.1.1-x64-Setup.exe
  release/RatHeart-SimPro-0.1.1-x64-Portable.exe
  release/RatHeart-SimPro-0.1.1-x86_64-AppImage
  release/ratheart-simpro_0.1.1_amd64.deb
  release/RatHeart-SimPro-0.1.1-mac.zip
  release/RatHeart-SimPro-0.1.1-arm64-mac.zip
  release/SHA256SUMS.txt
)

BODY=$(python3 -c "import json;print(json.dumps(open('release/RELEASE_NOTES_v0.1.1.md',encoding='utf-8').read()))")

echo "==> 已存在的 Release 检查(tag: ${TAG})"
RELEASE_ID=$(curl -s -H "Authorization: Bearer ${GH_TOKEN}" "${API}/releases/tags/${TAG}" \
  | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('id',''))
except Exception: print('')" || true)
if [ -n "${RELEASE_ID}" ]; then
  echo "    Release 已存在(id=${RELEASE_ID}),跳过创建,直接补传资产"
else
  echo "==> 创建 Release ${TAG}"
  RELEASE_ID=$(curl -sf -X POST "${API}/releases" \
    -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
    -d "{\"tag_name\":\"${TAG}\",\"name\":\"RatHeart-SimPro v0.1.1\",\"body\":${BODY},\"draft\":false,\"prerelease\":false}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  echo "    创建成功(id=${RELEASE_ID})"
fi

echo "==> 上传资产(共 ${#ASSETS[@]} 个,约 1 GB)"
EXISTING=$(curl -sf -H "Authorization: Bearer ${GH_TOKEN}" "${API}/releases/${RELEASE_ID}/assets?per_page=100")
for f in "${ASSETS[@]}"; do
  name=$(basename "$f")
  if echo "${EXISTING}" | python3 -c "
import json, sys, os
name, size = '$name', os.path.getsize('$f')
assets = json.load(sys.stdin)
sys.exit(0 if any(a['name'] == name and a['state'] == 'uploaded' and a['size'] == size for a in assets) else 1)" 2>/dev/null; then
    echo "    已存在且完整,跳过: ${name}"
    continue
  fi
  echo "    上传: ${name} ($(du -h "$f" | cut -f1))"
  curl -sf -X POST "${UPLOAD}/${RELEASE_ID}/assets?name=${name}" \
    -H "Authorization: Bearer ${GH_TOKEN}" -H "Content-Type: application/octet-stream" \
    --data-binary "@${f}" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('      → 状态', d.get('state'), d.get('browser_download_url',''))"
done
echo "==> 完成: https://github.com/${REPO}/releases/tag/${TAG}"
