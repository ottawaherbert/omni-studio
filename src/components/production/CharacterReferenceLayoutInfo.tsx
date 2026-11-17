import type { CharacterReferenceLayout } from '../../clients/domainTypes';
export function CharacterReferenceLayoutInfo({activeLayout}:{activeLayout?:CharacterReferenceLayout}) {
  return <div className="mb-4 text-xs text-text-muted">
    <p>角色参考：去头身体三视图＋完整脸部特写</p>
    <p className="mt-2 leading-5">身体三视图只负责服装和体型，完整脸部身份集中在右侧大特写；故事画面仍保留完整头部。受伤、换装等先选左侧对应状态。</p>
    {activeLayout && <p className="mt-1">当前采用：{activeLayout === 'body_face' ? '去头身体三视图＋脸部特写' : '历史完整三视图，待新版参考采用'}</p>}
  </div>;
}
