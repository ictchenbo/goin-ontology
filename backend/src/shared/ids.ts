// ID 生成工具：统一使用可读前缀 + 随机后缀
import { customAlphabet } from 'nanoid';

// 去掉易混淆字符的字母表
const alphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const nano = customAlphabet(alphabet, 16);

export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export function correlationId(): string {
  return `cor_${customAlphabet(alphabet, 12)()}`;
}
