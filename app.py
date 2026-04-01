# Hướng dẫn cài đặt:
# Mở terminal và chạy lệnh sau để cài đặt các thư viện cần thiết:
# pip install streamlit google-generativeai pypdf2 python-docx plotly

import streamlit as st
import google.generativeai as genai
import PyPDF2
import docx
import plotly.graph_objects as go
import json

# Cấu hình trang Streamlit
st.set_page_config(page_title="Đánh giá KHBD theo CV 5512", layout="wide")

# --- SIDEBAR ---
st.sidebar.title("Cấu hình")
api_key = st.sidebar.text_input("Nhập Gemini API Key", type="password")

if api_key:
    genai.configure(api_key=api_key)

# --- HÀM XỬ LÝ FILE ---
def extract_text_from_file(uploaded_file):
    text = ""
    try:
        if uploaded_file.name.endswith('.pdf'):
            pdf_reader = PyPDF2.PdfReader(uploaded_file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        elif uploaded_file.name.endswith('.docx'):
            doc = docx.Document(uploaded_file)
            for para in doc.paragraphs:
                text += para.text + "\n"
        elif uploaded_file.name.endswith('.txt'):
            text = uploaded_file.read().decode('utf-8')
    except Exception as e:
        st.error(f"Lỗi khi đọc file: {e}")
        return None
    return text

# --- HÀM GỌI GEMINI API ---
def analyze_lesson_plan(text):
    system_instruction = """
    Bạn là một Chuyên gia Công nghệ Giáo dục và Chuyên gia Đánh giá Giáo dục, am hiểu sâu sắc về Chương trình GDPT 2018 và hướng dẫn lập Kế hoạch bài dạy (KHBD) theo Công văn 5512 của Bộ GD&ĐT Việt Nam.
    Nhiệm vụ của bạn là đánh giá Kế hoạch bài dạy được cung cấp dựa trên 6 tiêu chí sau. Đặc biệt lưu ý rà soát sự thống nhất giữa mục tiêu hoạt động, nhiệm vụ học sinh và sản phẩm của học sinh ở các hoạt động (Mở đầu, Hình thành kiến thức, Luyện tập, Vận dụng):

    Tiêu chí 1: Mục tiêu dạy học (Tối đa 4 mức)
    Mức 1: Không bám sát Yêu cầu cần đạt (YCCĐ).
    Mức 2: Bám sát YCCĐ nhưng không có động từ thể hiện hành động của học sinh.
    Mức 3: Bám sát YCCĐ, có động từ hành động nhưng một số không đánh giá được.
    Mức 4: Bám sát YCCĐ, động từ thể hiện rõ hành động và hoàn toàn đánh giá được.

    Tiêu chí 2: Thiết bị và học liệu (Tối đa 4 mức)
    Mức 1: Không mô tả thiết bị/học liệu.
    Mức 2: Có mô tả nhưng chưa chỉ rõ số lượng/thông số.
    Mức 3: Có số lượng/thông số nhưng có chỗ chưa phù hợp.
    Mức 4: Phù hợp, chi tiết và có điểm mới sáng tạo.

    Tiêu chí 3: Hoạt động mở đầu (Tối đa 4 mức)
    Mức 1: Không yêu cầu học sinh xác định mục đích/nhiệm vụ.
    Mức 2: Thể hiện được nhiệm vụ nhưng không thể hiện ý nghĩa việc học, hoặc thiếu sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm.
    Mức 3: Thể hiện ý nghĩa, có sự thống nhất cơ bản giữa mục tiêu, nhiệm vụ và sản phẩm nhưng chưa hấp dẫn.
    Mức 4: Thu hút sự chú ý, khơi gợi tò mò và ham muốn khám phá; đảm bảo sự thống nhất chặt chẽ giữa mục tiêu, nhiệm vụ và sản phẩm.

    Tiêu chí 4: Hoạt động hình thành kiến thức (Tối đa 5 mức)
    Mức 1: Không bám sát YCCĐ.
    Mức 2: Bám sát YCCĐ nhưng giao nhiệm vụ không rõ ràng, hoặc thiếu sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm.
    Mức 3: Nhiệm vụ rõ ràng, có sự thống nhất cơ bản nhưng chưa hình dung ra sản phẩm học tập.
    Mức 4: Có sản phẩm minh họa, đảm bảo sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm nhưng thiếu hỗ trợ học sinh thực hiện.
    Mức 5: Đầy đủ sản phẩm minh họa, tiêu chí, có hướng dẫn hỗ trợ học sinh thực hiện và đảm bảo sự thống nhất tuyệt đối giữa mục tiêu, nhiệm vụ và sản phẩm.

    Tiêu chí 5: Hoạt động luyện tập (Tối đa 4 mức)
    Mức 1: Không củng cố YCCĐ.
    Mức 2: Có củng cố nhưng chưa đòi hỏi luyện tập trong bối cảnh tương tự, hoặc thiếu sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm.
    Mức 3: Có luyện tập, có sự thống nhất cơ bản giữa mục tiêu, nhiệm vụ và sản phẩm nhưng không có sự phân hóa/phân mức cho học sinh.
    Mức 4: Phân loại được bài tập với các mức độ khác nhau (có tính phân hóa) và đảm bảo sự thống nhất chặt chẽ giữa mục tiêu, nhiệm vụ và sản phẩm.

    Tiêu chí 6: Hoạt động vận dụng (Tối đa 5 mức)
    Mức 1: Không mang tính vận dụng kiến thức đã học.
    Mức 2: Có vận dụng nhưng chưa mô tả rõ tình huống thực tiễn, hoặc thiếu sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm.
    Mức 3: Gắn với thực tiễn, có sự thống nhất cơ bản giữa mục tiêu, nhiệm vụ và sản phẩm nhưng không nêu rõ sản phẩm cần đạt.
    Mức 4: Yêu cầu sản phẩm, đảm bảo sự thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm nhưng chưa có tiêu chí đánh giá/mẫu đáp án.
    Mức 5: Có hướng dẫn xây dựng, tiêu chí đánh giá/đáp án rõ ràng và đảm bảo sự thống nhất tuyệt đối giữa mục tiêu, nhiệm vụ và sản phẩm.

    Hãy trả về kết quả dưới dạng JSON với cấu trúc sau:
    {
        "criteriaScores": [
            {
                "criterion": "Tên tiêu chí",
                "score": <điểm số>,
                "maxScore": <điểm tối đa>,
                "reasoning": "Giải thích lý do (đặc biệt chỉ ra sự thiếu thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm nếu có)",
                "quote": "Trích dẫn nội dung thiếu sót (nếu có)",
                "suggestion": "Đề xuất cách viết lại (nếu có)"
            }
        ],
        "overallFeedback": "Nhận xét chung"
    }
    """
    
    try:
        model = genai.GenerativeModel(
            model_name="gemini-2.5-pro",
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"}
        )
        response = model.generate_content(text)
        return json.loads(response.text)
    except Exception as e:
        st.error(f"Lỗi khi gọi API: {e}")
        return None

# --- GIAO DIỆN CHÍNH ---
st.title("Phân tích và Đánh giá Kế hoạch Bài dạy (KHBD)")
st.markdown("Hệ thống tự động đánh giá KHBD theo Công văn 5512 của Bộ GD&ĐT sử dụng AI.")

uploaded_file = st.file_uploader("Tải lên file KHBD (.pdf, .docx, .txt)", type=['pdf', 'docx', 'txt'])

if st.button("Phân tích và Đánh giá KHBD"):
    if not api_key:
        st.warning("Vui lòng nhập Gemini API Key ở thanh bên trái.")
    elif not uploaded_file:
        st.warning("Vui lòng tải lên file KHBD.")
    else:
        with st.spinner("Đang trích xuất văn bản..."):
            text = extract_text_from_file(uploaded_file)
            
        if text:
            with st.spinner("Đang phân tích bằng AI... Quá trình này có thể mất vài chục giây."):
                result = analyze_lesson_plan(text)
                
            if result:
                st.success("Phân tích hoàn tất!")
                
                # 1. Bảng Tóm tắt
                st.subheader("1. Bảng Tóm tắt Điểm số")
                scores_data = []
                categories = []
                scores = []
                max_scores = []
                
                for item in result.get("criteriaScores", []):
                    scores_data.append({
                        "Tiêu chí": item["criterion"],
                        "Điểm đạt": item["score"],
                        "Điểm tối đa": item["maxScore"]
                    })
                    categories.append(item["criterion"])
                    scores.append(item["score"])
                    max_scores.append(item["maxScore"])
                    
                st.table(scores_data)
                
                # 2. Biểu đồ Radar
                st.subheader("2. Biểu đồ Năng lực Thiết kế KHBD")
                fig = go.Figure()
                
                fig.add_trace(go.Scatterpolar(
                    r=scores,
                    theta=categories,
                    fill='toself',
                    name='Điểm đạt được',
                    line_color='blue'
                ))
                
                fig.add_trace(go.Scatterpolar(
                    r=max_scores,
                    theta=categories,
                    fill=None,
                    name='Điểm tối đa',
                    line_color='red',
                    line_dash='dash'
                ))
                
                fig.update_layout(
                    polar=dict(
                        radialaxis=dict(
                            visible=True,
                            range=[0, 5]
                        )),
                    showlegend=True
                )
                st.plotly_chart(fig, use_container_width=True)
                
                # 3. Chi tiết Phản hồi & Điều chỉnh
                st.subheader("3. Chi tiết Phản hồi & Gợi ý Điều chỉnh")
                st.info(result.get("overallFeedback", ""))
                
                for item in result.get("criteriaScores", []):
                    with st.expander(f"{item['criterion']} - Đạt {item['score']}/{item['maxScore']}"):
                        st.write("**Lý do:**", item.get("reasoning", ""))
                        if item["score"] < item["maxScore"]:
                            if item.get("quote"):
                                st.warning(f"**Trích dẫn thiếu sót:**\n{item['quote']}")
                            if item.get("suggestion"):
                                st.success(f"**Gợi ý điều chỉnh:**\n{item['suggestion']}")
