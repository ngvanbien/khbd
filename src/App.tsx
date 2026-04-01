import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, File, FileType, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import ReactMarkdown from 'react-markdown';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, getDoc, setDoc } from 'firebase/firestore';

// Cấu hình worker cho pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface CriteriaScore {
  criterion: string;
  score: number;
  maxScore: number;
  reasoning: string;
  quote?: string;
  suggestion?: string;
}

interface AnalysisResult {
  criteriaScores: CriteriaScore[];
  overallFeedback: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            setIsAdmin(userSnap.data().role === 'admin');
          } else {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              role: 'user',
              createdAt: serverTimestamp()
            });
            setIsAdmin(false);
          }
        } catch (e) {
          console.error("Error checking user role", e);
        }
      } else {
        setIsAdmin(false);
        setShowAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchEvaluations = async () => {
    setIsLoadingAdmin(true);
    try {
      const q = query(collection(db, 'evaluations'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const evals: any[] = [];
      querySnapshot.forEach((doc) => {
        evals.push({ id: doc.id, ...doc.data() });
      });
      setEvaluations(evals);
    } catch (e) {
      console.error("Error fetching evaluations", e);
      alert("Lỗi khi tải dữ liệu: " + (e as Error).message);
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const handleShowAdmin = () => {
    setShowAdmin(true);
    fetchEvaluations();
  };

  const downloadCSV = () => {
    if (evaluations.length === 0) return;
    
    const headers = ['ID', 'Email', 'Tên File', 'Ngày tạo', 'Điểm T1', 'Điểm T2', 'Điểm T3', 'Điểm T4', 'Điểm T5', 'Điểm T6', 'Nhận xét chung'];
    const rows = evaluations.map(ev => {
      const date = ev.createdAt?.toDate ? ev.createdAt.toDate().toLocaleString() : '';
      const scores = ev.criteriaScores || [];
      const getScore = (idx: number) => scores[idx]?.score || 0;
      
      return [
        ev.id,
        ev.userEmail,
        ev.fileName,
        `"${date}"`,
        getScore(0), getScore(1), getScore(2), getScore(3), getScore(4), getScore(5),
        `"${ev.overallFeedback?.replace(/"/g, '""') || ''}"`
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ket_qua_danh_gia_khbd.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  };

  const extractTextFromDocx = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const handleAnalyze = async () => {
    if (!file) {
      setError('Vui lòng tải lên một tệp KHBD.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      let text = '';
      const arrayBuffer = await file.arrayBuffer();

      if (file.name.endsWith('.pdf')) {
        text = await extractTextFromPdf(arrayBuffer);
      } else if (file.name.endsWith('.docx')) {
        text = await extractTextFromDocx(arrayBuffer);
      } else if (file.name.endsWith('.txt')) {
        text = await file.text();
      } else {
        throw new Error('Định dạng tệp không được hỗ trợ. Vui lòng chọn .pdf, .docx, hoặc .txt');
      }

      if (!text.trim()) {
        throw new Error('Không thể trích xuất văn bản từ tệp. Tệp có thể rỗng hoặc không chứa văn bản.');
      }

      const systemInstruction = `
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

Đối với mỗi tiêu chí chưa đạt mức tối đa, hãy trích dẫn lại đoạn nội dung bị thiếu sót trong KHBD, giải thích lí do bị trừ điểm dựa trên rubric (đặc biệt chỉ ra sự thiếu thống nhất giữa mục tiêu, nhiệm vụ và sản phẩm nếu có), và đề xuất cụ thể cách viết lại đoạn đó để đạt mức tối đa.
      `;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          criteriaScores: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                criterion: { type: Type.STRING, description: "Tên tiêu chí (VD: Tiêu chí 1: Mục tiêu dạy học)" },
                score: { type: Type.INTEGER, description: "Điểm số đạt được" },
                maxScore: { type: Type.INTEGER, description: "Điểm số tối đa của tiêu chí này" },
                reasoning: { type: Type.STRING, description: "Giải thích lý do đạt điểm này" },
                quote: { type: Type.STRING, description: "Trích dẫn đoạn nội dung thiếu sót (nếu chưa đạt điểm tối đa)" },
                suggestion: { type: Type.STRING, description: "Đề xuất cách viết lại để đạt điểm tối đa (nếu chưa đạt)" }
              },
              required: ["criterion", "score", "maxScore", "reasoning"]
            }
          },
          overallFeedback: { type: Type.STRING, description: "Nhận xét chung" }
        },
        required: ["criteriaScores", "overallFeedback"]
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: text,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
        }
      });

      if (response.text) {
        const parsedResult = JSON.parse(response.text) as AnalysisResult;
        setResult(parsedResult);
        
        if (user) {
          try {
            await addDoc(collection(db, 'evaluations'), {
              userId: user.uid,
              userEmail: user.email,
              fileName: file.name,
              createdAt: serverTimestamp(),
              overallFeedback: parsedResult.overallFeedback,
              criteriaScores: parsedResult.criteriaScores
            });
          } catch (e) {
            console.error("Lỗi khi lưu kết quả vào database:", e);
          }
        }
      } else {
        throw new Error('Không nhận được phản hồi từ AI.');
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Đã xảy ra lỗi trong quá trình xử lý.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const radarData = result?.criteriaScores.map(item => ({
    subject: item.criterion.split(':')[0], // Lấy phần tên ngắn gọn (VD: Tiêu chí 1)
    fullSubject: item.criterion,
    score: item.score,
    maxScore: item.maxScore,
    fullMark: 5,
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <FileText size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Đánh giá KHBD theo CV 5512</h1>
              <p className="text-sm text-slate-500">Hệ thống phân tích Kế hoạch bài dạy tự động bằng AI</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-slate-600 hidden md:inline-block">{user.email}</span>
                {isAdmin && (
                  <button 
                    onClick={showAdmin ? () => setShowAdmin(false) : handleShowAdmin}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    {showAdmin ? 'Quay lại App' : 'Admin Dashboard'}
                  </button>
                )}
                <button onClick={logout} className="text-sm font-medium text-slate-600 hover:text-slate-800">Đăng xuất</button>
              </>
            ) : (
              <button onClick={loginWithGoogle} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors">
                Đăng nhập để lưu kết quả
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {showAdmin ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold">Quản lý Kết quả Đánh giá</h2>
              <button 
                onClick={downloadCSV}
                disabled={evaluations.length === 0}
                className="bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Tải về CSV
              </button>
            </div>
            
            {isLoadingAdmin ? (
              <div className="flex justify-center py-12">
                <Loader2 size={32} className="animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Tên File</th>
                      <th className="px-4 py-3 font-medium">Ngày tạo</th>
                      <th className="px-4 py-3 font-medium text-center">T1</th>
                      <th className="px-4 py-3 font-medium text-center">T2</th>
                      <th className="px-4 py-3 font-medium text-center">T3</th>
                      <th className="px-4 py-3 font-medium text-center">T4</th>
                      <th className="px-4 py-3 font-medium text-center">T5</th>
                      <th className="px-4 py-3 font-medium text-center">T6</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.map((ev) => (
                      <tr key={ev.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-700">{ev.userEmail}</td>
                        <td className="px-4 py-3 text-slate-700 max-w-[200px] truncate" title={ev.fileName}>{ev.fileName}</td>
                        <td className="px-4 py-3 text-slate-500">{ev.createdAt?.toDate ? ev.createdAt.toDate().toLocaleString() : ''}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[0]?.score || '-'}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[1]?.score || '-'}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[2]?.score || '-'}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[3]?.score || '-'}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[4]?.score || '-'}</td>
                        <td className="px-4 py-3 text-center">{ev.criteriaScores?.[5]?.score || '-'}</td>
                      </tr>
                    ))}
                    {evaluations.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">Chưa có dữ liệu đánh giá nào.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Upload Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload size={20} className="text-blue-600" />
            Tải lên Kế hoạch bài dạy
          </h2>
          
          <div 
            className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.docx,.txt"
              className="hidden" 
            />
            
            {file ? (
              <div className="flex flex-col items-center gap-3">
                <div className="bg-blue-100 p-3 rounded-full text-blue-600">
                  <File size={32} />
                </div>
                <div>
                  <p className="font-medium text-slate-700">{file.name}</p>
                  <p className="text-sm text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2">
                  Chọn tệp khác
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="bg-slate-100 p-3 rounded-full text-slate-500">
                  <FileType size={32} />
                </div>
                <div>
                  <p className="font-medium text-slate-700">Nhấn để chọn tệp</p>
                  <p className="text-sm text-slate-500">Hỗ trợ định dạng .pdf, .docx, .txt</p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-100">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleAnalyze}
              disabled={!file || isAnalyzing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Đang phân tích...
                </>
              ) : (
                <>
                  Phân tích và Đánh giá KHBD
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Section */}
        {result && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Summary & Chart */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Summary Table */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-semibold mb-4">1. Bảng Tóm tắt Điểm số</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-medium">Tiêu chí</th>
                        <th className="px-4 py-3 font-medium text-center">Đạt</th>
                        <th className="px-4 py-3 font-medium text-center">Tối đa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.criteriaScores.map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 font-medium text-slate-700">{item.criterion}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${item.score === item.maxScore ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} font-semibold`}>
                              {item.score}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-500">{item.maxScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Radar Chart */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
                <h3 className="text-lg font-semibold mb-4">2. Biểu đồ Năng lực Thiết kế</h3>
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fill: '#94a3b8' }} />
                      <Radar name="Điểm đạt" dataKey="score" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.5} />
                      <Radar name="Điểm tối đa" dataKey="maxScore" stroke="#ef4444" fill="none" strokeDasharray="3 3" />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number, name: string) => [value, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Detailed Feedback */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-semibold mb-4">3. Chi tiết Phản hồi & Gợi ý Điều chỉnh</h3>
              
              <div className="bg-blue-50 text-blue-800 p-4 rounded-lg mb-6 text-sm leading-relaxed border border-blue-100">
                <ReactMarkdown>{result.overallFeedback}</ReactMarkdown>
              </div>

              <div className="space-y-6">
                {result.criteriaScores.map((item, idx) => {
                  const isPerfect = item.score === item.maxScore;
                  return (
                    <div key={idx} className={`border rounded-xl overflow-hidden ${isPerfect ? 'border-green-200' : 'border-slate-200'}`}>
                      <div className={`px-5 py-3 flex items-center justify-between ${isPerfect ? 'bg-green-50' : 'bg-slate-50 border-b border-slate-200'}`}>
                        <h4 className="font-semibold text-slate-800">{item.criterion}</h4>
                        <div className="flex items-center gap-2">
                          {isPerfect && <CheckCircle size={18} className="text-green-600" />}
                          <span className={`font-bold ${isPerfect ? 'text-green-700' : 'text-amber-600'}`}>
                            {item.score} / {item.maxScore}
                          </span>
                        </div>
                      </div>
                      
                      <div className="p-5 space-y-4 text-sm">
                        <div>
                          <span className="font-semibold text-slate-700 block mb-1">Lý do đánh giá:</span>
                          <p className="text-slate-600 leading-relaxed">{item.reasoning}</p>
                        </div>

                        {!isPerfect && item.quote && (
                          <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg">
                            <span className="font-semibold text-amber-800 block mb-1">Trích dẫn nội dung thiếu sót:</span>
                            <p className="text-amber-700 italic">"{item.quote}"</p>
                          </div>
                        )}

                        {!isPerfect && item.suggestion && (
                          <div className="bg-emerald-50 border-l-4 border-emerald-400 p-3 rounded-r-lg">
                            <span className="font-semibold text-emerald-800 block mb-1">Gợi ý điều chỉnh (Để đạt mức tối đa):</span>
                            <div className="text-emerald-700 prose prose-sm prose-emerald max-w-none">
                              <ReactMarkdown>{item.suggestion}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}
