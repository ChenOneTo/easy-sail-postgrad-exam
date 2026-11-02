fn main() {
    // tauri-build 只声明 tauri.conf.json 等依赖，未声明图标文件；
    // 只换图标（不动配置）时增量构建不会重跑本脚本，exe 会沿用旧的
    // Windows 资源，表现为「装了新版本但图标还是旧 logo」。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
