// gunzip with a size cap. Apple's Compression framework decodes raw DEFLATE (COMPRESSION_ZLIB); the gzip wrapper
// (RFC 1952 header and trailer) is parsed here, and the CRC-32 and length in the trailer are checked.
import Compression
import Foundation

public enum Gzip {
    public static func decompress(_ gz: [UInt8], maxBytes: Int) throws -> [UInt8] {
        guard gz.count >= 18, gz[0] == 0x1F, gz[1] == 0x8B, gz[2] == 8 else { throw QBeamError.container("not gzip") }
        let flags = gz[3]
        var p = 10
        if flags & 0x04 != 0 { guard gz.count >= p + 2 else { throw QBeamError.container("bad gzip") }; p += 2 + Int(gz[p]) | Int(gz[p + 1]) << 8 }
        if flags & 0x08 != 0 { while p < gz.count, gz[p] != 0 { p += 1 }; p += 1 }   // file name
        if flags & 0x10 != 0 { while p < gz.count, gz[p] != 0 { p += 1 }; p += 1 }   // comment
        if flags & 0x02 != 0 { p += 2 }                                              // header CRC
        guard p < gz.count - 8 else { throw QBeamError.container("bad gzip") }
        let deflate = Array(gz[p..<(gz.count - 8)])

        var out = [UInt8]()
        let chunk = 64 * 1024
        var dst = [UInt8](repeating: 0, count: chunk)
        let streamPtr = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { streamPtr.deallocate() }
        guard compression_stream_init(streamPtr, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw QBeamError.container("decompressor unavailable")
        }
        defer { compression_stream_destroy(streamPtr) }
        try deflate.withUnsafeBufferPointer { src in
            streamPtr.pointee.src_ptr = src.baseAddress!
            streamPtr.pointee.src_size = src.count
            while true {
                let status: compression_status = dst.withUnsafeMutableBufferPointer { d in
                    streamPtr.pointee.dst_ptr = d.baseAddress!
                    streamPtr.pointee.dst_size = chunk
                    return compression_stream_process(streamPtr, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                }
                let produced = chunk - streamPtr.pointee.dst_size
                if out.count + produced > maxBytes {
                    throw QBeamError.container("too-large")
                }
                out += dst[0..<produced]
                if status == COMPRESSION_STATUS_END { break }
                guard status == COMPRESSION_STATUS_OK else { throw QBeamError.container("corrupt gzip") }
            }
        }
        let crc = UInt32(gz[gz.count - 8]) | UInt32(gz[gz.count - 7]) << 8 | UInt32(gz[gz.count - 6]) << 16 | UInt32(gz[gz.count - 5]) << 24
        let size = UInt32(gz[gz.count - 4]) | UInt32(gz[gz.count - 3]) << 8 | UInt32(gz[gz.count - 2]) << 16 | UInt32(gz[gz.count - 1]) << 24
        guard CRC32.checksum(out) == crc, UInt32(truncatingIfNeeded: out.count) == size else { throw QBeamError.container("corrupt gzip") }
        return out
    }
}
