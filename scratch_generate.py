import pandas as pd
from pathlib import Path

# Headers chuẩn theo định dạng mới (Loại bỏ các trường không cần thiết cho Teky LMS)
headers = [
    "Question Type", "Question Text", "Image", "Video",
    "Difficulty", "Topic", "Explanation", "Points"
] + [f"Answer {i}" for i in range(1, 11)]

# Dữ liệu cho 9 loại câu hỏi
data = [
    [
        "MC",
        "Trắc nghiệm (Chọn 1): Máy tính điện tử đầu tiên trên thế giới tên là gì?",
        "", "https://youtube.com/watch?v=sample", "easy", "Lịch sử máy tính",
        "ENIAC được chế tạo năm 1945.", 1,
        "*ENIAC", "EDVAC", "UNIVAC", "Z3"
    ] + [""] * 6,
    [
        "MR",
        "Trắc nghiệm (Chọn nhiều): Những hệ điều hành nào dưới đây dành cho điện thoại di động?",
        "", "", "easy", "Hệ điều hành",
        "Android và iOS là 2 hệ điều hành phổ biến nhất.", 1,
        "*Android", "Windows 11", "*iOS", "Ubuntu"
    ] + [""] * 6,
    [
        "TF",
        "Đúng / Sai: Địa chỉ IP 192.168.1.1 là địa chỉ IP Public.",
        "", "", "medium", "Mạng máy tính",
        "Đây là IP Private dùng trong mạng LAN.", 1,
        "Đúng", "*Sai"
    ] + [""] * 8,
    [
        "MG",
        "Ghép cặp: Nối phím tắt tương ứng với chức năng của nó trên hệ điều hành Windows.",
        "", "", "easy", "Tin học cơ bản",
        "Đây là các phím tắt tiêu chuẩn toàn cầu.", 1,
        "Ctrl + C | Sao chép (Copy)", "Ctrl + V | Dán (Paste)", "Ctrl + Z | Hoàn tác (Undo)"
    ] + [""] * 7,
    [
        "SEQ",
        "Sắp xếp thứ tự: Sắp xếp các đơn vị đo lường bộ nhớ sau từ NHỎ đến LỚN.",
        "", "", "medium", "Phần cứng",
        "Bit -> Byte -> KB -> MB.", 1,
        "Bit", "Byte", "Kilobyte (KB)", "Megabyte (MB)"
    ] + [""] * 6,
    [
        "FIB",
        "Điền vào chỗ trống: Trình duyệt web mặc định đi kèm với Windows 10/11 tên là [Edge].",
        "", "", "easy", "Phần mềm",
        "Microsoft Edge là trình duyệt web do Microsoft phát triển.", 1
    ] + [""] * 10,
    [
        "TI",
        "Trả lời ngắn: Ngôn ngữ đánh dấu siêu văn bản dùng để xây dựng bộ khung trang web có tên viết tắt là gì?",
        "", "", "easy", "Lập trình Web",
        "HTML viết tắt của HyperText Markup Language.", 1,
        "*HTML", "*html"
    ] + [""] * 8,
    [
        "NUM",
        "Đáp án số: Hệ nhị phân (Binary) sử dụng bao nhiêu chữ số cơ bản để biểu diễn dữ liệu?",
        "", "", "medium", "Toán rời rạc",
        "Hệ nhị phân (cơ số 2) chỉ sử dụng 0 và 1.", 1,
        "=2"
    ] + [""] * 9,
    [
        "MNUM",
        "Nhiều đáp án số: Giải phương trình bậc 2 sau: x^2 - 3x + 2 = 0. Nghiệm nhỏ điền trước, nghiệm lớn điền sau.",
        "", "", "hard", "Toán học",
        "Theo định lý Vi-ét: x1 = 1 và x2 = 2.", 1,
        "=1", "=2"
    ] + [""] * 8
]

df = pd.DataFrame(data, columns=headers)
output_path = Path("/Users/mac/Downloads/SCORM-PROJECT/scorm-editor/docs/Quiz_Template_9_Types.xlsx")
output_path.parent.mkdir(parents=True, exist_ok=True)
df.to_excel(output_path, index=False)
print(f"File created successfully at {output_path}")
