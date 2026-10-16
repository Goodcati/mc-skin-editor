/**
 * 旧版皮肤格式处理。
 *
 * 为什么需要这个文件：skinview3d 判断旧版皮肤的依据是「图片宽 ≠ 高」（即 64x32），
 * 而我们的文档画布恒为 64x64 —— 旧版皮肤被贴进上半部分后，交给 skinview3d 时
 * 已经是一张 64x64 的图，它不会再做转换，结果是 3D 模型直接缺掉左腿和左臂。
 * 所以必须在导入时就把布局补全，这里是唯一的正确位置。
 */

/** 旧版皮肤：宽高比 2:1（64x32），内容只占画布上半部分 */
export function isLegacySkinSize(width: number, height: number): boolean {
  return width === height * 2
}

/**
 * 把旧版 64x32 布局补全为 1.8 的 64x64 布局。
 *
 * 算法逐一移植自 bs-community/skinview-utils 的 `convertSkinTo1_8`
 * （skinview3d 自身的依赖），与 Minecraft 客户端为旧皮肤生成左腿 / 左臂的方式一致：
 * 把右腿、右臂的各个面水平镜像后写入 1.8 新增的左腿 / 左臂区域。
 *
 * 实现细节：借助 `scale(-1, 1)` 翻转坐标系，让 drawImage 在绘制时顺带完成水平镜像。
 * 源和目标不重叠，所以可以直接读写同一张 canvas。
 */
export function convertSkinTo1x8(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.save()
  ctx.scale(-1, 1)

  const scale = width / 64
  const copySkin = (
    sX: number,
    sY: number,
    w: number,
    h: number,
    dX: number,
    dY: number,
  ) => {
    ctx.drawImage(
      ctx.canvas,
      sX * scale,
      sY * scale,
      w * scale,
      h * scale,
      -dX * scale,
      dY * scale,
      -w * scale,
      h * scale,
    )
  }

  // 左腿 <- 右腿
  copySkin(4, 16, 4, 4, 20, 48) // 顶面
  copySkin(8, 16, 4, 4, 24, 48) // 底面
  copySkin(0, 20, 4, 12, 24, 52) // 外侧面
  copySkin(4, 20, 4, 12, 20, 52) // 正面
  copySkin(8, 20, 4, 12, 16, 52) // 内侧面
  copySkin(12, 20, 4, 12, 28, 52) // 背面

  // 左臂 <- 右臂
  copySkin(44, 16, 4, 4, 36, 48) // 顶面
  copySkin(48, 16, 4, 4, 40, 48) // 底面
  copySkin(40, 20, 4, 12, 40, 52) // 外侧面
  copySkin(44, 20, 4, 12, 36, 52) // 正面
  copySkin(48, 20, 4, 12, 32, 52) // 内侧面
  copySkin(52, 20, 4, 12, 44, 52) // 背面

  ctx.restore()
}
